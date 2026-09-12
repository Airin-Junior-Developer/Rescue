function databaseConfig(env) {
    const config = {
        host: env.DB_HOST,
        port: Number(env.DB_PORT || 3306),
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
    };
    if (env.DB_SSL === 'true') {
        if (!env.DB_SSL_CA) throw new Error('DB_SSL_CA is required when DB_SSL=true');
        config.ssl = { ca: env.DB_SSL_CA, rejectUnauthorized: true };
    }
    return config;
}

module.exports = { databaseConfig };
