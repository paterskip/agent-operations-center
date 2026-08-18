import { z } from "zod";

export const TaskCreateSchema = z.object({
  board: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Nieprawidłowy board"),
  title: z
    .string()
    .transform((s) => s.trim().replace(/[\u0000-\u001f\u007f]/g, " "))
    .pipe(z.string().min(3, "Tytuł musi mieć 3–160 znaków").max(160, "Tytuł musi mieć 3–160 znaków")),
  body: z
    .string()
    .transform((s) => s.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " "))
    .pipe(z.string().min(10, "Opis musi mieć 10–6000 znaków").max(6000, "Opis musi mieć 10–6000 znaków")),
  assignee: z
    .string()
    .optional()
    .nullable()
    .transform((s) => (s ? s.trim() || null : null)),
  priority: z.number({ message: "Nieprawidłowe dane priorytetu (1-4)" }).refine((n): n is 1 | 2 | 3 | 4 => [1, 2, 3, 4].includes(n), {
    message: "Nieprawidłowe dane priorytetu (1-4)",
  }),
});

export const TaskPatchSchema = z.object({
  board: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Nieprawidłowy board"),
  taskId: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/, "Nieprawidłowy task"),
  targetStatus: z.string().min(1, "Brak statusu docelowego"),
});

export const CommentCreateSchema = z.object({
  board: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Nieprawidłowy board"),
  taskId: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/, "Nieprawidłowy task"),
  comment: z
    .string()
    .transform((s) => s.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " "))
    .pipe(z.string().min(2, "Komentarz musi zawierać co najmniej 2 znaki").max(2000, "Komentarz nie może przekraczać 2000 znaków")),
});

export const DecisionActionSchema = z.enum(["approve", "reject", "resume", "hold"]);

export const DecisionCreateSchema = z.object({
  board: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Nieprawidłowy board"),
  taskId: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/, "Nieprawidłowy task"),
  action: DecisionActionSchema,
  comment: z
    .string()
    .optional()
    .default("")
    .transform((s) => s.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " "))
    .pipe(z.string().max(2000, "Komentarz jest za długi")),
});

export const IdeaCreateSchema = z.object({
  title: z
    .string()
    .transform((s) => s.trim().replace(/[\u0000-\u001f\u007f]/g, " "))
    .pipe(z.string().min(3, "Tytuł musi mieć 3–160 znaków").max(160, "Tytuł musi mieć 3–160 znaków")),
  description: z
    .string()
    .transform((s) => s.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " "))
    .pipe(z.string().min(10, "Opis musi mieć 10–6000 znaków").max(6000, "Opis musi mieć 10–6000 znaków")),
  project: z.string().min(1, "Nieznany projekt docelowy"),
  priority: z.number({ message: "Nieprawidłowy priorytet (1-4)" }).refine((n): n is 1 | 2 | 3 | 4 => [1, 2, 3, 4].includes(n), {
    message: "Nieprawidłowy priorytet (1-4)",
  }),
  mode: z.enum(["draft", "analysis"], { message: "Nieprawidłowy tryb (draft/analysis)" }),
});
