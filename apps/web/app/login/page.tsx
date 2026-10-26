import { loginAction } from "@/lib/auth";
import { PendingButton } from "@/components/pending-button";
import { BrandMark } from "@/components/shell";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className="login-page">
      <form className="login-card" action={loginAction}>
        <div className="login-brand">
          <BrandMark />
          <div>
            <div className="login-brand-title">ScanerBlogers</div>
            <div className="login-brand-subtitle">закрытая админка</div>
          </div>
        </div>
        <div className="login-heading">
          <h1>Вход</h1>
          <p>Введите данные администратора</p>
        </div>
        <div className="login-form-grid">
          <input className="input" name="email" placeholder="Почта" type="email" required />
          <input className="input" name="password" placeholder="Пароль" type="password" required />
          {params.error ? <div className="badge red">Неверный логин или пароль</div> : null}
          <PendingButton className="button primary" pendingText="Входим" type="submit">Войти</PendingButton>
        </div>
      </form>
    </main>
  );
}
