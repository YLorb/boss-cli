/** Enter was attempted. A failed receipt is never authorization to resend. */
export class EmbeddedSendUnconfirmedError extends Error {
  constructor(public readonly details: Record<string, unknown>) {
    super('已尝试按下发送键，但未确认新消息回执；结果待核验，禁止补发。'+JSON.stringify(details));
    this.name='EmbeddedSendUnconfirmedError';
  }
}
