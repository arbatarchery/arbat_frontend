-- Bounded ordered batches. Original per-operation checks are preserved.
begin;
create function arbat_private.apply_training_operation(p_principal uuid, p_buddy_subject text, p_operation jsonb, p_rate_checked boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_id uuid; v_session uuid; v_entity uuid; v_kind text; v_base bigint;
  v_payload jsonb; v_hash text; v_receipt arbat_private.sync_operations%rowtype;
  v_row public.training_sessions%rowtype; v_revision bigint; v_allowed text[];
begin
  if p_principal is null or jsonb_typeof(p_operation) is distinct from 'object'
     or octet_length(p_operation::text)>32768 then raise exception 'invalid_operation' using errcode='22023'; end if;
  if p_operation - array['operation_id','session_id','entity_id','kind','base_revision','payload'] <> '{}'::jsonb then
    raise exception 'unknown_operation_fields' using errcode='22023'; end if;
  v_id:=(p_operation->>'operation_id')::uuid; v_session:=(p_operation->>'session_id')::uuid;
  v_entity:=(p_operation->>'entity_id')::uuid; v_kind:=p_operation->>'kind';
  v_base:=(p_operation->>'base_revision')::bigint; v_payload:=p_operation->'payload';
  if v_id is null or v_session is null or v_entity is null or v_base is null or v_base<0
    or jsonb_typeof(v_payload) is distinct from 'object' then raise exception 'invalid_operation' using errcode='22023'; end if;
  v_allowed:=case v_kind
    when 'session.upsert' then array['legacy_session_id','local_date','timezone','started_at','session_type','arrows_per_end','shooting_distance','target_size','notes']
    when 'session.close' then array['ended_at']
    when 'end.upsert' then array['ordinal','ended_at','arrow_limit','session_type','shooting_distance','target_size','notes']
    when 'arrow.upsert' then array['end_id','ordinal','label','score','x','y','recorded_at']
    when 'arrow.delete' then array[]::text[] else null end;
  if v_allowed is null or v_payload-v_allowed <> '{}'::jsonb then raise exception 'invalid_payload_fields' using errcode='22023'; end if;
  if v_kind in ('session.upsert','session.close') and v_entity<>v_session then raise exception 'invalid_entity' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('arbat-principal:'||p_principal::text,0));
  v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
  if not p_rate_checked and not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited'); end if;
  perform pg_advisory_xact_lock(hashtextextended('arbat-session:'||v_session::text,0));
  select * into v_row from public.training_sessions where id=v_session for update;
  if v_row.id is not null and v_row.owner_id<>v_actor then raise exception 'not_owner' using errcode='42501'; end if;
  v_hash:=encode(sha256(convert_to(p_operation::text,'UTF8')),'hex');
  select * into v_receipt from arbat_private.sync_operations where principal_id=p_principal and operation_id=v_id;
  if v_receipt.operation_id is not null then
    if v_receipt.payload_hash<>v_hash then raise exception 'operation_id_reused' using errcode='22023'; end if;
    return jsonb_build_object('status','accepted','revision',v_receipt.confirmed_revision,'replayed',true);
  end if;
  if coalesce(v_row.revision,0)<>v_base then
    return jsonb_build_object('status','conflict','revision',coalesce(v_row.revision,0));
  end if;
  if v_row.id is null and v_kind<>'session.upsert' then raise exception 'session_missing' using errcode='22023'; end if;
  if v_row.ended_at is not null then raise exception 'session_closed' using errcode='22023'; end if;
  if v_row.deleted_at is not null then raise exception 'session_deleted' using errcode='22023'; end if;
  v_revision:=v_base+1;
  if v_kind='session.upsert' then
    if v_row.id is null and (select count(*) from public.training_sessions where owner_id=v_actor)>=
      (case when p_buddy_subject is null then 100 else 10000 end) then
      return jsonb_build_object('status','quota_exceeded');
    end if;
    insert into public.training_sessions(id,owner_id,legacy_session_id,local_date,timezone,started_at,session_type,arrows_per_end,shooting_distance,target_size,notes,revision)
    values(v_session,v_actor,v_payload->>'legacy_session_id',(v_payload->>'local_date')::date,v_payload->>'timezone',
      (v_payload->>'started_at')::timestamptz,coalesce(v_payload->>'session_type','training'),(v_payload->>'arrows_per_end')::smallint,
      v_payload->>'shooting_distance',v_payload->>'target_size',coalesce(v_payload->>'notes',''),v_revision)
    on conflict(id) do update set legacy_session_id=excluded.legacy_session_id,local_date=excluded.local_date,timezone=excluded.timezone,
      started_at=excluded.started_at,session_type=excluded.session_type,arrows_per_end=excluded.arrows_per_end,
      shooting_distance=excluded.shooting_distance,target_size=excluded.target_size,notes=excluded.notes;
  elsif v_kind='end.upsert' then
    if exists(select 1 from public.training_ends where id=v_entity and session_id<>v_session) then raise exception 'invalid_parent' using errcode='22023'; end if;
    insert into public.training_ends(id,session_id,ordinal,ended_at,arrow_limit,session_type,shooting_distance,target_size,notes,revision)
      values(v_entity,v_session,(v_payload->>'ordinal')::integer,(v_payload->>'ended_at')::timestamptz,
        (v_payload->>'arrow_limit')::smallint,v_payload->>'session_type',v_payload->>'shooting_distance',v_payload->>'target_size',v_payload->>'notes',v_revision)
      on conflict(id) do update set ordinal=excluded.ordinal,ended_at=excluded.ended_at,arrow_limit=excluded.arrow_limit,
        session_type=excluded.session_type,shooting_distance=excluded.shooting_distance,target_size=excluded.target_size,notes=excluded.notes,revision=excluded.revision;
  elsif v_kind='arrow.upsert' then
    if exists(select 1 from public.training_arrows where id=v_entity and (session_id<>v_session or deleted_at is not null)) then
      raise exception 'invalid_arrow_identity' using errcode='22023'; end if;
    if not exists(select 1 from public.training_arrows where id=v_entity) and
      ((select count(*) from public.training_arrows where session_id=v_session)>=10000
       or (select count(*) from public.training_arrows a join public.training_sessions s on s.id=a.session_id where s.owner_id=v_actor)>=
         (case when p_buddy_subject is null then 50000 else 500000 end)) then
      return jsonb_build_object('status','quota_exceeded');
    end if;
    insert into public.training_arrows(id,session_id,end_id,ordinal,label,score,x,y,recorded_at,revision)
      values(v_entity,v_session,(v_payload->>'end_id')::uuid,(v_payload->>'ordinal')::integer,v_payload->>'label',
        (v_payload->>'score')::smallint,(v_payload->>'x')::float8,(v_payload->>'y')::float8,(v_payload->>'recorded_at')::timestamptz,v_revision)
      on conflict(id) do update set end_id=excluded.end_id,ordinal=excluded.ordinal,label=excluded.label,score=excluded.score,
        x=excluded.x,y=excluded.y,recorded_at=excluded.recorded_at,revision=excluded.revision;
  elsif v_kind='arrow.delete' then
    update public.training_arrows set deleted_at=now(),revision=v_revision where id=v_entity and session_id=v_session and deleted_at is null;
    if not found then raise exception 'arrow_missing' using errcode='22023'; end if;
  elsif v_kind='session.close' then
    if v_payload->>'ended_at' is null then raise exception 'ended_at_required' using errcode='22023'; end if;
    update public.training_sessions set ended_at=(v_payload->>'ended_at')::timestamptz where id=v_session;
  end if;
  update public.training_sessions set revision=v_revision,updated_at=now() where id=v_session;
  insert into arbat_private.sync_operations(principal_id,operation_id,session_id,payload_hash,confirmed_revision)
    values(p_principal,v_id,v_session,v_hash,v_revision);
  return jsonb_build_object('status','accepted','revision',v_revision,'replayed',false);
end; $$;

-- Single-operation compatibility keeps the original request-level rate check.
create or replace function public.training_apply_operation(p_principal uuid,p_buddy_subject text,p_operation jsonb)
returns jsonb language sql security definer set search_path = '' as $$
 select arbat_private.apply_training_operation(p_principal,p_buddy_subject,p_operation,false);
$$;

create function public.training_apply_batch(p_principal uuid,p_buddy_subject text,p_operations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_op jsonb; v_result jsonb; v_results jsonb:='[]'::jsonb;
 v_stopped boolean:=false; v_code text; v_session text;
begin
 if jsonb_typeof(p_operations) is distinct from 'array' then
  raise exception 'invalid_batch' using errcode='22023';
 end if;
 if jsonb_array_length(p_operations) not between 1 and 32 or octet_length(p_operations::text)>131072 then
  raise exception 'invalid_batch' using errcode='22023';
 end if;
 v_session:=p_operations->0->>'session_id';
 if v_session is null or exists(select 1 from jsonb_array_elements(p_operations) op where op->>'session_id' is distinct from v_session) then
  raise exception 'invalid_batch_sessions' using errcode='22023';
 end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
 -- One rate-limit unit per bounded request, not per arrow. Row/storage quotas
 -- and ownership checks remain inside each operation. No client can skip them.
 if not arbat_private.ingress_allow(v_actor) then
  v_stopped:=true;
 end if;
 for v_op in select value from jsonb_array_elements(p_operations) loop
  if v_stopped then
   v_result:=jsonb_build_object('status',case when jsonb_array_length(v_results)=0 then 'rate_limited' else 'not_attempted' end);
  else
   begin
    v_result:=arbat_private.apply_training_operation(p_principal,p_buddy_subject,v_op,true);
   exception when others then
    get stacked diagnostics v_code=returned_sqlstate;
    v_result:=case
     when v_code='28000' then jsonb_build_object('status','retry_or_auth_required','code','claim_or_buddy_required')
     when v_code='42501' then jsonb_build_object('status','retry_or_auth_required','code','not_owner')
     when left(v_code,2) in ('22','23') then jsonb_build_object('status','rejected','code','operation_rejected')
     else jsonb_build_object('status','retry_or_auth_required','code','server_unavailable') end;
   end;
   v_stopped:=v_result->>'status' is distinct from 'accepted';
  end if;
  v_results:=v_results||jsonb_build_array(jsonb_build_object('operation_id',v_op->>'operation_id')||v_result);
 end loop;
 return jsonb_build_object('results',v_results);
end; $$;
revoke all on function arbat_private.apply_training_operation(uuid,text,jsonb,boolean),public.training_apply_batch(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.training_apply_batch(uuid,text,jsonb) to service_role;
commit;
