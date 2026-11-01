// Preloaded with `node --import` so the server and auth CLI talk to a local mock instead of Google.
const port = process.env.MOCK_GOOGLE_PORT;
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = String(input instanceof URL ? input.href : input)
    .replace("https://oauth2.googleapis.com/token", `http://127.0.0.1:${port}/token`)
    .replace("https://www.googleapis.com/youtube/v3/", `http://127.0.0.1:${port}/`);
  return realFetch(url, init);
};
