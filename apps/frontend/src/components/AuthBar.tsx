import { useEffect, useState } from 'react';
import { login, register, logout, startOAuth, onAuthChange, type NexusUser } from '../lib/auth.js';

export function AuthBar() {
  const [user, setUser] = useState<NexusUser | null>(null);
  useEffect(() => onAuthChange(setUser), []);

  if (user) {
    return (
      <div className="auth-user">
        <span className="auth-email">{user.email} <span className="role-pill">{(user.roles ?? []).join(', ')}</span></span>
        <button onClick={logout} className="auth-signout">Sign out</button>
      </div>
    );
  }
  return <LoginForm />;
}

function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name || email.split('@')[0]);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  return (
    <div className="auth-form">
      <form onSubmit={submit} className="auth-fields">
        {mode === 'register' && (
          <input className="auth-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input className="auth-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="auth-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="auth-error">{err}</p>}
        <button className="auth-submit" type="submit">
          {mode === 'login' ? 'Sign in' : 'Register'}
        </button>
      </form>
      <button className="auth-toggle" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Need an account?' : 'Already have one?'}
      </button>
      <div className="oauth-row">
        <button onClick={() => startOAuth('google')} className="oauth-button">Google</button>
        <button onClick={() => startOAuth('facebook')} className="oauth-button">Facebook</button>
      </div>
    </div>
  );
}
