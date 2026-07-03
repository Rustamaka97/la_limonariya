import { auditLog } from "./db/schema";

// Минимал insert-интерфейс — db ҳам, транзакция tx ҳам мос келади.
type Inserter = {
  insert: (table: typeof auditLog) => {
    values: (value: typeof auditLog.$inferInsert) => PromiseLike<unknown>;
  };
};

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  summary?: string | null;
  meta?: unknown;
};

// Ўзгармас аудит ёзуви. tx берилса — асосий мутация билан атомик. Асосий
// мутация ичида await қилинг (журнал ёзилмаса, амал ҳам ёзилмаслиги керак —
// изсиз ўзгариш бўлмасин).
export async function logAudit(db: Inserter, e: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: e.actorId,
    action: e.action,
    entity: e.entity ?? null,
    entityId: e.entityId ?? null,
    summary: e.summary ?? null,
    meta: (e.meta ?? null) as never,
  });
}
