type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
export type ArticleResult = { bodyText: string; customData?: JsonObject };
export class ArticlePage {
  constructor(readonly text: string, readonly url: string) {}
}
class ArticleItem {
  constructor(readonly url: string) {}
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("文字列を指定してください。");
  return value;
}

function page(value: unknown): ArticlePage {
  if (!(value instanceof ArticlePage)) throw new TypeError("http-get の応答が必要です。");
  return value;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  return jsonObject(value);
}

export function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("JSONオブジェクトを指定してください。");
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
}

class FetchResult implements ArticleResult {
  constructor(readonly bodyText: string, readonly customData?: JsonObject) {}
}

export function createArticleFetcher(BiwaScheme: typeof import("biwascheme").default) {
  // Keep only Scheme data operations. Browser and JavaScript bindings are excluded.
  const allowed = new Set([
    "define-macro", "and", "or", "let", "let*", "letrec", "letrec*", "cond",
    "=", "<", ">", "+", "-", "*", "/", "not", "equal?", "null?", "pair?",
    "cons", "car", "cdr", "list", "list?", "length", "append", "map", "filter",
    "symbol?", "string?", "string=?", "string-append", "vector", "error"
  ]);
  for (const name of Object.keys(BiwaScheme.CoreEnv)) {
    if (!allowed.has(name)) delete BiwaScheme.CoreEnv[name];
  }

  function interpreter() {
    return new BiwaScheme.Interpreter(error => { throw error; });
  }
  BiwaScheme.define_libfunc("item-url", 1, 1, ([item]) => {
    if (!(item instanceof ArticleItem)) throw new TypeError("記事が必要です。");
    return item.url;
  });
  BiwaScheme.define_libfunc("response-text", 1, 1, ([response]) => page(response).text);
  BiwaScheme.define_libfunc("response-url", 1, 1, ([response]) => page(response).url);
  BiwaScheme.define_libfunc("json-object", 0, 1024, args => {
    if (args.length % 2 !== 0) throw new TypeError("キーと値をペアで指定してください。");
    const entries: [string, JsonValue][] = [];
    for (let index = 0; index < args.length; index += 2) {
      entries.push([string(args[index]), jsonValue(args[index + 1])]);
    }
    return Object.fromEntries(entries);
  });
  BiwaScheme.define_libfunc("article-result", 1, 2, ([body, data]) =>
    new FetchResult(string(body), data === undefined ? undefined : jsonObject(data)));

  interpreter().evaluate(`
    (define-macro (define-article-fetcher args . body)
      (if (and (list? args) (= (length args) 1) (symbol? (car args)) (pair? body))
          (cons 'define (cons (cons 'fetch-article args) body))
          (error "define-article-fetcher expects one parameter and a body")))
  `);

  return function runArticleFetcher(
    url: string,
    source: string,
    getPage: (url: string) => Promise<ArticlePage>,
    extract: (html: string, url: string) => Promise<string>
  ): Promise<ArticleResult> {
    return new Promise((resolve, reject) => {
      const runtime = interpreter();
      const fetcher = runtime.evaluate(`(lambda (http-get extract-article-text current-item)
        ${source}
        (fetch-article current-item))`);

      function finish(value: unknown) {
        if (value instanceof BiwaScheme.Pause) return;
        if (!(value instanceof FetchResult)) throw new TypeError("article-result が必要です。");
        resolve(value);
      }
      function pauseFor<T>(request: () => Promise<T>) {
        return new BiwaScheme.Pause(pause => {
          Promise.resolve().then(request).then(value => finish(pause.resume(value))).catch(reject);
        });
      }
      function httpGet(args: unknown[]) {
        if (args.length !== 1) throw new TypeError("http-get にはURLを1つ指定してください。");
        return pauseFor(() => getPage(string(args[0])));
      }
      function extractText(args: unknown[]) {
        if (args.length !== 2) throw new TypeError("extract-article-text にはHTMLとURLを指定してください。");
        return pauseFor(() => extract(string(args[0]), string(args[1])));
      }
      finish(runtime.invoke_closure(fetcher, [httpGet, extractText, new ArticleItem(url)]));
    });
  };
}
