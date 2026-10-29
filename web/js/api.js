// Thin fetch wrapper: returns JSON or throws an Error with the server's message.

async function request(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('Server unreachable. Is server.py running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const getState = () => request('GET', '/api/state');
export const post = (url, body = {}) => request('POST', url, body);
export const put = (url, body) => request('PUT', url, body);
export const del = (url) => request('DELETE', url);
