import { useEffect, useState } from 'react';
import { gql, subscribe } from '../lib/graphql.js';
import { onAuthChange, type NexusUser } from '../lib/auth.js';

interface MeResult { me: { id: string; email: string; name?: string; roles: string[] } | null }
interface UsersResult { users: { id: string; email: string; name?: string; roles: string[] }[] }

export function Home() {
  const [user, setUser] = useState<NexusUser | null>(null);
  const [users, setUsers] = useState<UsersResult['users']>([]);
  const [count, setCount] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => onAuthChange(setUser), []);

  const refresh = async () => {
    setErr('');
    try {
      const r = await gql<UsersResult>(`{ users { id email name roles } }`);
      setUsers(r.users);
      setCount(r.users.length);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  useEffect(() => {
    // Live user-count over a GraphQL subscription (proves the non-Apollo WS path).
    const off = subscribe<{ userCount: number }>(
      `subscription { userCount }`,
      undefined,
      (data) => { if (data?.userCount != null) setCount(data.userCount); },
    );
    refresh();
    return () => off();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Welcome to BhooAI Nexus</h2>
        {user ? (
          <p className="text-slate-600">Signed in as <b>{user.email}</b> ({(user.roles ?? []).join(', ')}).</p>
        ) : (
          <p className="text-slate-600">Sign in (or register — the first user becomes admin) to explore the framework.</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Live user count (subscription)" value={count} />
        <Stat label="Users listed" value={users.length} />
        <Stat label="Your roles" value={(user?.roles ?? []).join(', ') || '—'} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Users (GraphQL query)</h3>
          <button onClick={refresh} className="text-sm text-indigo-600">refresh</button>
        </div>
        {err && <p className="text-red-600 text-sm mb-2">{err}</p>}
        <table className="w-full text-sm">
          <thead><tr className="text-slate-500 text-left border-b"><th className="py-1">Email</th><th>Name</th><th>Roles</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="py-1.5">{u.email}</td><td>{u.name ?? '—'}</td><td className="text-slate-500">{(u.roles ?? []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="text-slate-500 text-xs">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}