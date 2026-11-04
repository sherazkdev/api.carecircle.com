module.exports = {
  apps: [
    {
      name: 'care-circle-reminder',
      cwd: '/var/www/care-circle-reminder',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 1001,
      },
    },
  ],
};
