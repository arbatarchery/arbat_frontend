import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('training foundation on PostgreSQL: constraints, grants and RLS', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  // Emulate only the Supabase Auth interface consumed by this migration.
  // No tokens, live users or remote database are involved.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  const migration = await readFile(new URL('../migrations/202611010001_training_foundation.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  // 1 athlete A, 2 athlete B, 3 coach, 4 admin A, 5 superadmin,
  // 6 anonymous, 7 admin B, 8 ordinary user with forged browser roles.
  for (let n = 1; n <= 8; n++) {
    await db.query('insert into auth.users values ($1, $2)', [id(n), n === 6]);
    await db.query('insert into public.training_profiles(id) values ($1)', [id(n)]);
  }
  await db.exec(`
    insert into arbat_private.schools values ('${id(100)}','A'), ('${id(101)}','B');
    insert into arbat_private.school_members values
      ('${id(100)}','${id(1)}'), ('${id(101)}','${id(2)}'), ('${id(100)}','${id(3)}');
    insert into arbat_private.role_assignments(user_id, role, school_id) values
      ('${id(3)}','coach','${id(100)}'), ('${id(4)}','admin','${id(100)}'),
      ('${id(5)}','superadmin',null), ('${id(7)}','admin','${id(101)}'),
      ('${id(6)}','superadmin',null);
    insert into arbat_private.coach_athletes values ('${id(100)}','${id(3)}','${id(1)}',true);
    insert into public.training_sessions(id,owner_id,school_id,local_date,legacy_session_id) values
      ('${id(201)}','${id(1)}','${id(100)}','2026-11-01','legacy-A'),
      ('${id(202)}','${id(2)}','${id(101)}','2026-11-01','legacy-B'),
      ('${id(203)}','${id(6)}',null,'2026-11-01','anon'),
      ('${id(204)}','${id(1)}',null,'2026-11-01','personal');
    insert into public.training_ends(id,session_id,ordinal) values
      ('${id(301)}','${id(201)}',1), ('${id(302)}','${id(202)}',1);
    insert into public.training_arrows(id,session_id,end_id,ordinal,label,score) values
      ('${id(401)}','${id(201)}','${id(301)}',1,'X',10),
      ('${id(402)}','${id(202)}','${id(302)}',1,'M',0);
  `);
  async function asRole(role, n, callback) {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [n ? id(n) : '']);
      return await callback();
    } finally { await db.exec('rollback'); }
  }
  const sessions = async () => (await db.query('select id from public.training_sessions order by id')).rows.map(r => r.id);
  const denied = async sql => assert.rejects(db.exec(sql), e => e.code === '42501');
  const constraint = async sql => {
    await db.exec('begin');
    try { await assert.rejects(db.exec(sql), e => ['23503','23505','23514'].includes(e.code)); }
    finally { await db.exec('rollback'); }
  };

  await t.test('every foundation table has RLS; private schema is not accessible anonymously', async () => {
    const rows = (await db.query(`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and n.nspname in ('public','arbat_private')`)).rows;
    assert.equal(rows.length, 12);
    assert.ok(rows.every(r => r.relrowsecurity));
    await asRole('anon', null, () => denied('select * from arbat_private.role_assignments'));
    await asRole('anon', null, () => denied('select * from public.training_sessions'));
  });
  await t.test('owner isolation includes sessions on the same date', async () => {
    await asRole('authenticated', 1, async () => {
      assert.deepEqual(await sessions(), [id(201), id(204)]);
      assert.equal((await db.query('select * from public.training_ends')).rows.length, 1);
      assert.equal((await db.query('select * from public.training_arrows')).rows.length, 1);
      assert.deepEqual((await db.query('select id from public.training_profiles')).rows.map(r => r.id), [id(1)]);
    });
    await asRole('authenticated', 2, async () => assert.deepEqual(await sessions(), [id(202)]));
    await asRole('authenticated', null, async () => assert.deepEqual(await sessions(), []));
  });
  await t.test('coach access requires active assignment and role in the same school', async () => {
    await asRole('authenticated', 3, async () => assert.deepEqual(await sessions(), [id(201)]));
    await db.exec('begin');
    await db.exec('update arbat_private.coach_athletes set active=false');
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id(3)]);
    assert.deepEqual(await sessions(), []);
    await db.exec('rollback');
  });
  await t.test('administrator is scoped; superadmin can read all sessions', async () => {
    await asRole('authenticated', 4, async () => assert.deepEqual(await sessions(), [id(201)]));
    await asRole('authenticated', 7, async () => assert.deepEqual(await sessions(), [id(202)]));
    await asRole('authenticated', 5, async () => assert.deepEqual(await sessions(), [id(201),id(202),id(203),id(204)]));
  });
  await t.test('anonymous principal cannot elevate even with a stored role and forged claim', async () => {
    await asRole('authenticated', 6, async () => {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({is_anonymous:false, user_metadata:{role:'superadmin'}})]);
      assert.deepEqual(await sessions(), [id(203)]);
    });
    await asRole('authenticated', 8, async () => {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({user_metadata:{role:'superadmin'}})]);
      assert.deepEqual(await sessions(), []);
    });
  });
  await t.test('client writes, ownership changes, role grants and private reads are denied', async () => {
    for (const sql of [
      `insert into public.training_sessions(id,owner_id) values ('${id(299)}','${id(1)}')`,
      `update public.training_sessions set owner_id='${id(2)}' where id='${id(201)}'`,
      'delete from public.training_arrows',
      `insert into arbat_private.role_assignments(user_id,role) values ('${id(1)}','superadmin')`,
      'select * from arbat_private.external_identities',
      'select * from arbat_private.anonymous_claims',
      'select * from arbat_private.audit_events',
      'select * from arbat_private.sync_operations'
    ]) await asRole('authenticated', 1, () => denied(sql));
    // Even a privileged app user is read-only in this foundation.
    await asRole('authenticated', 5, () => denied('delete from public.training_sessions'));
    await asRole('service_role', null, () => denied('insert into public.training_profiles(id) values (gen_random_uuid())'));
  });
  await t.test('UUID and parent constraints prevent duplication and cross-session arrows', async () => {
    await constraint(`insert into public.training_sessions(id,owner_id) values ('${id(201)}','${id(1)}')`);
    await constraint(`insert into public.training_arrows(id,session_id,end_id,ordinal,label,score) values ('${id(499)}','${id(201)}','${id(302)}',2,'9',9)`);
    await constraint(`insert into public.training_arrows(id,session_id,ordinal,label,score) values ('${id(499)}','${id(201)}',2,'X',9)`);
    await constraint(`insert into public.training_arrows(id,session_id,ordinal,label,score,x,y) values ('${id(499)}','${id(201)}',2,'9',9,'NaN',1)`);
    await constraint(`insert into public.training_sessions(id,owner_id,school_id) values ('${id(299)}','${id(2)}','${id(100)}')`);
  });
  await t.test('operation receipt is unique per principal and claim is consumable once', async () => {
    await db.exec(`insert into arbat_private.sync_operations(principal_id,operation_id,session_id,payload_hash,confirmed_revision)
      values ('${id(1)}','${id(501)}','${id(201)}',repeat('a',64),1)`);
    await constraint(`insert into arbat_private.sync_operations(principal_id,operation_id,session_id,payload_hash,confirmed_revision)
      values ('${id(1)}','${id(501)}','${id(201)}',repeat('b',64),2)`);
    await db.exec(`insert into arbat_private.anonymous_claims(anonymous_id,target_id,proof_hash,expires_at,consumed_at)
      values ('${id(6)}','${id(1)}',repeat('a',64),now()+interval '5 minutes',now())`);
    await constraint(`insert into arbat_private.anonymous_claims(anonymous_id,target_id,proof_hash,expires_at,consumed_at)
      values ('${id(6)}','${id(2)}',repeat('b',64),now()+interval '5 minutes',now())`);
  });
  await t.test('tombstone preserves deleted arrow while permitting its replacement', async () => {
    await db.exec(`update public.training_arrows set deleted_at=now(),revision=2 where id='${id(401)}';
      insert into public.training_arrows(id,session_id,end_id,ordinal,label,score)
      values ('${id(403)}','${id(201)}','${id(301)}',1,'9',9)`);
    await asRole('authenticated', 1, async () => {
      const rows = (await db.query('select deleted_at from public.training_arrows')).rows;
      assert.equal(rows.length, 2);
      assert.equal(rows.filter(r => r.deleted_at !== null).length, 1);
    });
  });
});
