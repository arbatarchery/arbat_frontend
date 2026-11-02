-- Only the Edge function may resolve a subject verified against Buddy.
begin;
create function public.training_buddy_lookup(p_subject text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if p_subject is null or length(trim(p_subject)) not between 1 and 256 then
  raise exception 'invalid_subject' using errcode='22023';
 end if;
 select user_id into v_id from arbat_private.external_identities
 where issuer='https://api.statetty.com' and subject=p_subject;
 return jsonb_build_object('status','accepted','principal_id',v_id);
end; $$;
revoke all on function public.training_buddy_lookup(text) from public,anon,authenticated;
grant execute on function public.training_buddy_lookup(text) to service_role;
commit;
