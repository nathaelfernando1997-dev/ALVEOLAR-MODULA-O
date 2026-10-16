import { useState } from 'react';
import * as cloud from './cloud.ts';

export function Login({ carregando, recuperando, fimRecuperacao }: { carregando: boolean; recuperando: boolean; fimRecuperacao: () => void }) {
  const [modo, setModo] = useState<'entrar' | 'cadastrar' | 'esqueci'>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const exec = async (f: () => Promise<void>) => { setErro(''); setMsg(''); setOcupado(true); try { await f(); } catch (e) { setErro((e as Error).message); } setOcupado(false); };

  if (carregando) return <div className="login"><div className="card"><p>Carregando…</p></div></div>;
  if (recuperando) return (
    <div className="login"><form className="card" onSubmit={e => { e.preventDefault(); exec(async () => { await cloud.novaSenha(senha); fimRecuperacao(); }); }}>
      <h1>Alveolar Modulação</h1><h2>Nova senha</h2>
      <input type="password" placeholder="Nova senha (mínimo 6 caracteres)" value={senha} onChange={e => setSenha(e.target.value)} autoFocus />
      <button type="submit" disabled={ocupado}>Salvar nova senha</button>
      {erro && <p className="erro">{erro}</p>}
    </form></div>);

  return (
    <div className="login">
      <form className="card" onSubmit={e => {
        e.preventDefault();
        if (modo === 'entrar') exec(() => cloud.entrar(email, senha));
        else if (modo === 'cadastrar') exec(async () => { const confirmar = await cloud.cadastrar(email, senha); if (confirmar) setMsg('Conta criada. Enviamos um link para o seu e-mail: clique nele para confirmar e depois entre.'); });
        else exec(async () => { await cloud.recuperarSenha(email); setMsg('Se o e-mail tiver conta, enviamos um link para criar uma nova senha.'); });
      }}>
        <h1>Alveolar Modulação</h1>
        <h2>{modo === 'entrar' ? 'Entrar' : modo === 'cadastrar' ? 'Criar conta' : 'Recuperar senha'}</h2>
        <input type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
        {modo !== 'esqueci' && <input type="password" placeholder={modo === 'cadastrar' ? 'Senha (mínimo 6 caracteres)' : 'Senha'} value={senha} onChange={e => setSenha(e.target.value)} required />}
        <button type="submit" disabled={ocupado}>{modo === 'entrar' ? 'Entrar' : modo === 'cadastrar' ? 'Criar conta' : 'Enviar link'}</button>
        {erro && <p className="erro">{erro}</p>}
        {msg && <p className="ok">{msg}</p>}
        <div className="links">
          {modo !== 'entrar' && <a onClick={() => setModo('entrar')}>Já tenho conta</a>}
          {modo !== 'cadastrar' && <a onClick={() => setModo('cadastrar')}>Criar conta</a>}
          {modo !== 'esqueci' && <a onClick={() => setModo('esqueci')}>Esqueci a senha</a>}
        </div>
      </form>
    </div>
  );
}
