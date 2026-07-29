// PM2 process definitions for all 3 apps.
// Run from the repo root: pm2 start pm2/ecosystem.config.js
// Each app loads its own .env file from its service directory.

module.exports = {
  apps: [
    {
      name: 'order-service',
      cwd: './services/order-service',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      autorestart: true,
      watch: false,
      out_file: '/var/log/pm2/order-service.out.log',
      error_file: '/var/log/pm2/order-service.err.log',
      time: true
    },
    {
      name: 'payment-service',
      cwd: './services/payment-service',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      autorestart: true,
      watch: false,
      out_file: '/var/log/pm2/payment-service.out.log',
      error_file: '/var/log/pm2/payment-service.err.log',
      time: true
    },
    {
      name: 'frontend',
      cwd: './frontend',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '200M',
      autorestart: true,
      watch: false,
      out_file: '/var/log/pm2/frontend.out.log',
      error_file: '/var/log/pm2/frontend.err.log',
      time: true
    }
  ]
};
