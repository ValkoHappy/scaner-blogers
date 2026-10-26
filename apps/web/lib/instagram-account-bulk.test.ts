import { describe, expect, it } from "vitest";
import { parseInstagramAccountLine } from "./instagram-account-bulk";

describe("instagram account bulk parser", () => {
  it("parses pipe rows with login:password credentials", () => {
    expect(parseInstagramAccountLine("user1:pass1|198.51.100.10:8000:px:secret|.instagram/user1.json|Main account")).toEqual({
      username: "user1",
      password: "pass1",
      label: "Main account",
      sessionFile: ".instagram/user1.json",
      proxyUrl: "socks5h://px:secret@198.51.100.10:8000"
    });
  });

  it("keeps colons inside password for pipe credentials", () => {
    expect(parseInstagramAccountLine("user2:pa:ss|http://127.0.0.1:8080")).toMatchObject({
      username: "user2",
      password: "pa:ss",
      proxyUrl: "http://127.0.0.1:8080"
    });
  });

  it("parses comma rows with separate username and password", () => {
    expect(parseInstagramAccountLine("user3,pass3,127.0.0.1:8080,.instagram/user3.json,Backup")).toEqual({
      username: "user3",
      password: "pass3",
      label: "Backup",
      sessionFile: ".instagram/user3.json",
      proxyUrl: "http://127.0.0.1:8080"
    });
  });

  it("uses safe defaults for simple login:password rows", () => {
    expect(parseInstagramAccountLine("user4:pass4")).toEqual({
      username: "user4",
      password: "pass4",
      label: "user4",
      sessionFile: ".instagram/user4.session.json"
    });
  });

  it("drops invalid rows", () => {
    expect(parseInstagramAccountLine("only-login")).toBeNull();
    expect(parseInstagramAccountLine("")).toBeNull();
  });
});
