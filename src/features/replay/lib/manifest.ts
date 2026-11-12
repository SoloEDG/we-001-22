import type {
  ArchiveManifest,
  Battle,
  EventMeta,
} from "../../../shared/types";
import { clone } from "../../../shared/document";

export function newArchiveId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `ar-${Date.now().toString(36)}-${rand}`;
}

export function buildManifestBase(args: {
  archiveId: string;
  chunkSize: number;
  initial: Battle;
  live: Battle;
  events: EventMeta[];
}): Pick<
  ArchiveManifest,
  "version" | "archiveId" | "chunkSize" | "createdAt" | "updatedAt" | "initial" | "live" | "events"
> {
  const now = new Date().toISOString();
  return {
    version: 2,
    archiveId: args.archiveId,
    chunkSize: args.chunkSize,
    createdAt: now,
    updatedAt: now,
    initial: clone(args.initial),
    live: clone(args.live),
    events: clone(args.events),
  };
}
