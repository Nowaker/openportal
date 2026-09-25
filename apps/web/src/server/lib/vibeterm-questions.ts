// Relay a vibeterm-api /vibeterm/question response with its status intact.
// The client needs the real status (202 still delivering, 409 already
// sent, 502 delivery failed) and the error body's `name`, which h3's
// default JSON handling would flatten into a generic 500. The content type
// is relayed too: a plain `opencode serve` answers an unknown path with its
// web app's HTML, which the client must be able to tell from a JSON list.
export async function relayVibetermQuestionResponse(
  upstream: Response,
): Promise<Response> {
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
