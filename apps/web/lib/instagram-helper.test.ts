import { describe, expect, it } from "vitest";
import { buildInstagramSessionHelperPowerShell, resolveInstagramHelperAppRoot } from "./instagram-helper.js";

describe("instagram helper builder", () => {
  it("prefers explicit SCANER_APP_ROOT when present", () => {
    expect(resolveInstagramHelperAppRoot({ cwd: "C:/fallback", appRootEnv: "E:/app-root" })).toBe("E:/app-root");
  });

  it("keeps cwd when it already points to the app root", () => {
    expect(resolveInstagramHelperAppRoot({ cwd: "E:/ScanerBlogers/app" })).toBe("E:/ScanerBlogers/app");
  });

  it("falls back to the real app root when Next cwd points into apps/web", () => {
    expect(resolveInstagramHelperAppRoot({ cwd: "E:/ScanerBlogers/app/apps/web" })).toBe(process.cwd());
  });

  it("builds a powershell helper that calls the canonical collector entrypoint", () => {
    const script = buildInstagramSessionHelperPowerShell({
      appRoot: "E:/ScanerBlogers/app",
      defaultLogin: "login@example.com",
      proxyUrl: "socks5h://user:pass@127.0.0.1:9000"
    });

    expect(script).toContain("collectors\\instagram\\session_helper.py");
    expect(script).toContain(".venv-instagram\\Scripts\\python.exe");
    expect(script).toContain("--default-login");
    expect(script).toContain("login@example.com");
    expect(script).toContain("socks5h://user:pass@127.0.0.1:9000");
  });

  it("encodes appRoot safely for Cyrillic paths", () => {
    const script = buildInstagramSessionHelperPowerShell({
      appRoot: "E:/Проекты/ScanerBlogers/app",
      defaultLogin: "login@example.com",
      proxyUrl: ""
    });

    expect(script).toContain("FromBase64String");
    expect(script).not.toContain("Проекты");
    expect(script).not.toContain("РџСЂ");
  });
});
