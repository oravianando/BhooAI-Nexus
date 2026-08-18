// Example trusted plugin: registers an analytics route + an admin page,
// and subscribes to the "order:completed" event to count orders in-memory.
let orderCount = 0;

export default {
  async install(ctx) {
    ctx.logger.info('analytics plugin installed');
  },
  async start(ctx) {
    ctx.http.addRoute('GET', '/analytics/report', (c) => {
      c.json({ orders: orderCount });
    });
    ctx.admin.registerAdminPage({
      path: '/plugins/analytics',
      title: 'Analytics',
      group: 'Insights',
      icon: 'chart',
      order: 10,
    });
    ctx.events.subscribe('order:completed', () => { orderCount += 1; });
    ctx.logger.info('analytics plugin started');
  },
  async stop(ctx) {
    ctx.logger.info('analytics plugin stopped', { totalOrders: orderCount });
  },
};