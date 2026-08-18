// Example sandboxed plugin: runs in a worker_thread. A crash here cannot take
// the host down. It registers a single greeting route; the host proxies inbound
// requests into this worker and returns the response.
export default {
  async start(ctx) {
    ctx.logger.info('hello-worker started (sandboxed)');
    ctx.http.addRoute('GET', '/hello', (c) => {
      c.json({ msg: `hello from ${ctx.pluginName}`, config: ctx.config });
    });
  },
};