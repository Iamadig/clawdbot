import { Type } from "@sinclair/typebox";

export const WhatsAppToolSchema = Type.Object({
  action: Type.Literal("react"),
  chatJid: Type.String(),
  messageId: Type.String(),
  emoji: Type.Optional(Type.String()),
  remove: Type.Optional(Type.Boolean()),
  participant: Type.Optional(Type.String()),
  accountId: Type.Optional(Type.String()),
  fromMe: Type.Optional(Type.Boolean()),
});
