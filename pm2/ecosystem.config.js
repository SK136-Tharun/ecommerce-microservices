// PM2 process definitions -- runs the app as "mode: pm2" on its own set
// of ports/DB, distinct from the systemd deployment (mode: systemd) and
// the Docker deployment (mode: docker), so all three can run side by side
// on the same box for comparison.
//
// Run from the repo root: pm2 start pm2/ecosystem.config.js
//
// Env values are set directly here (not via .env files) so this file is
// self-contained -- PM2 injects these into each process's environment
// before it starts, and dotenv.config() inside the app does not override
// already-set variables, so these values always win.

const DB_PASSWORD = process.env.DB_PASSWORD || 'change_me_strong_password';

module.exports = {
  apps: [
    {
      name: 'order-service-pm2',
      cwd: './services/order-service',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      out_file: '/var/log/pm2/order-service.out.log',
      error_file: '/var/log/pm2/order-service.err.log',
      time: true,
      env: {
        PORT: 4012,
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_USER: 'appuser',
        DB_PASSWORD,
        DB_NAME: 'appdb_pm2',
        PAYMENT_SERVICE_URL: 'http://localhost:4022',
        DEPLOY_MODE: 'pm2',
        LOG_LEVEL: 'info'
      }
    },
    {
      name: 'payment-service-pm2',
      cwd: './services/payment-service',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      out_file: '/var/log/pm2/payment-service.out.log',
      error_file: '/var/log/pm2/payment-service.err.log',
      time: true,
      env: {
        PORT: 4022,
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_USER: 'appuser',
        DB_PASSWORD,
        DB_NAME: 'appdb_pm2',
        ORDER_SERVICE_URL: 'http://localhost:4012',
        DEPLOY_MODE: 'pm2',
        LOG_LEVEL: 'info'
      }
    },
    {
      name: 'frontend-pm2',
      cwd: './frontend',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      out_file: '/var/log/pm2/frontend.out.log',
      error_file: '/var/log/pm2/frontend.err.log',
      time: true,
      env: {
        PORT: 3002,
        ORDER_SERVICE_URL: 'http://localhost:4012',
        PAYMENT_SERVICE_URL: 'http://localhost:4022',
        DEPLOY_MODE: 'pm2'
      }
    }
  ]
};
