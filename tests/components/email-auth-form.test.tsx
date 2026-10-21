import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmailAuthForm } from "@/components/auth/EmailAuthForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const actions = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  requestReset: vi.fn(),
  resendVerificationEmail: vi.fn(),
  checkEmailDomain: vi.fn(),
}));
vi.mock("@/server/actions/auth-email", () => actions);
const docNav = vi.hoisted(() => ({ loadDocument: vi.fn(), reloadDocument: vi.fn() }));
vi.mock("@/components/analytics/document-nav", () => docNav);

beforeEach(() => {
  vi.clearAllMocks();
  actions.checkEmailDomain.mockResolvedValue({ blocked: false, message: null });
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("EmailAuthForm: вход", () => {
  it("logs in and navigates to the returned path", async () => {
    actions.login.mockResolvedValue({ ok: true, data: { redirectTo: "/cabinet/listings" } });
    render(<EmailAuthForm canRegister />);

    fill("Почта", "a@ya.ru");
    fill("Пароль", "normalnyi-parol");
    click("Войти");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/cabinet/listings"));
    expect(actions.login).toHaveBeenCalledWith({ email: "a@ya.ru", password: "normalnyi-parol", callbackUrl: "/" });
  });

  // На /login уже поднят счётчик Метрики с Вебвизором; клиентский переход
  // оставил бы его записывать админку.
  it("goes to the admin area with a full page load, not a client navigation", async () => {
    actions.login.mockResolvedValue({ ok: true, data: { redirectTo: "/admin/users?x=1" } });
    render(<EmailAuthForm canRegister callbackUrl="/admin/users?x=1" />);

    fill("Почта", "a@ya.ru");
    fill("Пароль", "normalnyi-parol");
    click("Войти");

    await waitFor(() => expect(docNav.loadDocument).toHaveBeenCalledWith("/admin/users?x=1"));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the server error", async () => {
    actions.login.mockResolvedValue({ ok: false, error: "Неверная почта или пароль" });
    render(<EmailAuthForm canRegister />);

    fill("Почта", "a@ya.ru");
    fill("Пароль", "wrong-password");
    click("Войти");

    expect(await screen.findByText("Неверная почта или пароль")).toBeInTheDocument();
  });

  it("offers to resend the letter when the email is not verified", async () => {
    actions.login.mockResolvedValue({
      ok: false, error: "Почта не подтверждена — отправьте письмо ещё раз", code: "email_not_verified",
    });
    actions.resendVerificationEmail.mockResolvedValue({ ok: true, data: undefined });
    render(<EmailAuthForm canRegister />);

    fill("Почта", "a@ya.ru");
    fill("Пароль", "normalnyi-parol");
    click("Войти");

    await screen.findByRole("button", { name: "Отправить письмо ещё раз" });
    click("Отправить письмо ещё раз");
    await waitFor(() => expect(actions.resendVerificationEmail).toHaveBeenCalledWith("a@ya.ru", "/"));
  });

  it("does not offer resending on a plain wrong password", async () => {
    actions.login.mockResolvedValue({ ok: false, error: "Неверная почта или пароль", code: "invalid_credentials" });
    render(<EmailAuthForm canRegister />);

    fill("Почта", "a@ya.ru");
    fill("Пароль", "wrong-password");
    click("Войти");

    await screen.findByText("Неверная почта или пароль");
    expect(screen.queryByRole("button", { name: "Отправить письмо ещё раз" })).toBeNull();
  });
});

describe("EmailAuthForm: регистрация", () => {
  it("switches modes and asks to repeat the password", () => {
    render(<EmailAuthForm canRegister />);
    click("Регистрация");
    expect(screen.getByLabelText("Повторите пароль")).toBeInTheDocument();
  });

  it("refuses mismatched passwords without calling the server", async () => {
    render(<EmailAuthForm canRegister />);

    click("Регистрация");
    fill("Почта", "a@ya.ru");
    fill("Имя", "Марина");
    fill("Пароль", "normalnyi-parol");
    fill("Повторите пароль", "drugoi-parol");
    click("Зарегистрироваться");

    expect(await screen.findByText("Пароли не совпадают")).toBeInTheDocument();
    expect(actions.register).not.toHaveBeenCalled();
  });

  it("shows the blocked domain notice on blur and blocks submit", async () => {
    actions.checkEmailDomain.mockResolvedValue({
      blocked: true, message: "Регистрация с почт gmail.com не поддерживается — войдите через Яндекс или VK",
    });
    render(<EmailAuthForm canRegister />);

    click("Регистрация");
    fill("Почта", "a@gmail.com");
    fireEvent.blur(screen.getByLabelText("Почта"));

    expect(await screen.findByText(/gmail\.com не поддерживается/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Зарегистрироваться" })).toBeDisabled();
  });

  it("does not check the domain in login mode", () => {
    render(<EmailAuthForm canRegister />);
    fill("Почта", "a@gmail.com");
    fireEvent.blur(screen.getByLabelText("Почта"));
    expect(actions.checkEmailDomain).not.toHaveBeenCalled();
  });

  it("shows the sent screen after a successful registration", async () => {
    actions.register.mockResolvedValue({ ok: true, data: { sentTo: "a@ya.ru" } });
    render(<EmailAuthForm canRegister />);

    click("Регистрация");
    fill("Почта", "a@ya.ru");
    fill("Имя", "Марина");
    fill("Пароль", "normalnyi-parol");
    fill("Повторите пароль", "normalnyi-parol");
    click("Зарегистрироваться");

    expect(await screen.findByText(/Письмо отправлено на/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить письмо ещё раз" })).toBeInTheDocument();
  });
});

describe("EmailAuthForm: сброс пароля", () => {
  it("answers the same way regardless of the account", async () => {
    actions.requestReset.mockResolvedValue({ ok: true, data: undefined });
    render(<EmailAuthForm canRegister />);

    click("Забыли пароль?");
    fill("Почта", "nobody@ya.ru");
    click("Отправить ссылку");

    expect(await screen.findByText(/зарегистрирована, мы отправили/)).toBeInTheDocument();
  });
});

describe("EmailAuthForm: без почтового транспорта", () => {
  it("hides registration and password recovery but keeps the login form", () => {
    render(<EmailAuthForm canRegister={false} />);

    expect(screen.getByRole("button", { name: "Войти" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Регистрация" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Забыли пароль?" })).toBeNull();
  });
});

describe("EmailAuthForm: поле имени", () => {
  it("спрашивает имя только при регистрации", () => {
    render(<EmailAuthForm canRegister />);
    expect(screen.queryByLabelText("Имя")).toBeNull();

    click("Регистрация");
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it("передаёт имя на сервер", async () => {
    actions.register.mockResolvedValue({ ok: true, data: { sentTo: "a@ya.ru" } });
    render(<EmailAuthForm canRegister />);

    click("Регистрация");
    fill("Почта", "a@ya.ru");
    fill("Имя", "Марина");
    fill("Пароль", "normalnyi-parol");
    fill("Повторите пароль", "normalnyi-parol");
    click("Зарегистрироваться");

    await waitFor(() => expect(actions.register).toHaveBeenCalledWith({
      email: "a@ya.ru", password: "normalnyi-parol", name: "Марина", callbackUrl: "/",
    }));
  });
});

describe("EmailAuthForm: возврат с экрана «письмо отправлено»", () => {
  it("возвращает к форме регистрации с сохранённым адресом", async () => {
    actions.register.mockResolvedValue({ ok: true, data: { sentTo: "a@ya.ru" } });
    render(<EmailAuthForm canRegister />);

    click("Регистрация");
    fill("Почта", "a@ya.ru");
    fill("Имя", "Марина");
    fill("Пароль", "normalnyi-parol");
    fill("Повторите пароль", "normalnyi-parol");
    click("Зарегистрироваться");

    await screen.findByText(/Письмо отправлено на/);
    click("Изменить адрес");

    // Поля на месте и заполнены — опечатку можно поправить, а не вводить заново.
    expect((screen.getByLabelText("Почта") as HTMLInputElement).value).toBe("a@ya.ru");
    expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe("Марина");
  });
});

describe("EmailAuthForm: глазок пароля", () => {
  it("прячет показанный пароль при смене режима", () => {
    render(<EmailAuthForm canRegister />);
    fill("Пароль", "sekretnyi-parol");
    click("Показать пароль");
    expect(screen.getByLabelText("Пароль")).toHaveAttribute("type", "text");

    click("Регистрация");
    expect(screen.getByLabelText("Пароль")).toHaveAttribute("type", "password");
  });
});
