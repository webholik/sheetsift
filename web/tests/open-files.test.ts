import { beforeEach, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  notify: () => {},
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
import { onOpenFiles } from "../src/lib/book.tauri";

beforeEach(() => {
  vi.resetAllMocks();
  ipc.invoke.mockResolvedValue([]);
  ipc.listen.mockImplementation(async (_event, notify) => {
    ipc.notify = notify;
    return ipc.unlisten;
  });
});

it("opens files received before startup and later notifications exactly once", async () => {
  const open = vi.fn();
  const fault = vi.fn();
  const first = "/tmp/매출 report %20 #1.xlsx";
  ipc.invoke.mockResolvedValueOnce([first]);
  const stop = await onOpenFiles(open, fault);
  expect(open.mock.calls).toEqual([[first, "매출 report %20 #1.xlsx"]]);
  ipc.invoke.mockResolvedValueOnce(["/tmp/second.xls", "/tmp/third.csv"]);
  ipc.notify();
  ipc.notify();
  await vi.waitFor(() => expect(ipc.invoke).toHaveBeenCalledTimes(3));
  expect(open.mock.calls).toEqual([
    [first, "매출 report %20 #1.xlsx"],
    ["/tmp/second.xls", "second.xls"],
    ["/tmp/third.csv", "third.csv"],
  ]);
  expect(fault).not.toHaveBeenCalled();
  stop();
  expect(ipc.unlisten).toHaveBeenCalledOnce();
});

it("preserves a request that arrives while the startup drain is in flight", async () => {
  let finish!: (paths: string[]) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise<string[]>((resolve) => { finish = resolve; }));
  const open = vi.fn();
  const watching = onOpenFiles(open, vi.fn());
  await vi.waitFor(() => expect(ipc.invoke).toHaveBeenCalledOnce());
  ipc.invoke.mockResolvedValueOnce(["/tmp/later.xlsx"]);
  ipc.notify();
  finish(["/tmp/startup.xlsx"]);
  const stop = await watching;
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  expect(open.mock.calls.map(([path]) => path)).toEqual(["/tmp/startup.xlsx", "/tmp/later.xlsx"]);
  stop();
});

it("reports IPC errors and can still receive subsequent requests", async () => {
  const open = vi.fn();
  const fault = vi.fn();
  ipc.invoke.mockRejectedValueOnce("unavailable");
  const stop = await onOpenFiles(open, fault);
  expect(fault).toHaveBeenCalledOnce();
  ipc.invoke.mockResolvedValueOnce(["/tmp/recovered.xlsx"]);
  ipc.notify();
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith("/tmp/recovered.xlsx", "recovered.xlsx"));
  stop();
});

it("stops dispatching when a pending response arrives after cleanup", async () => {
  const open = vi.fn();
  const stop = await onOpenFiles(open, vi.fn());
  let finish!: (paths: string[]) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise<string[]>((resolve) => { finish = resolve; }));
  ipc.notify();
  await vi.waitFor(() => expect(ipc.invoke).toHaveBeenCalledTimes(2));
  stop();
  finish(["/tmp/late.xlsx"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(open).not.toHaveBeenCalled();
});
