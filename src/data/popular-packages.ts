/**
 * Curated seed list of popular packages per ecosystem, used as typosquat
 * targets. A name that is a near-miss of one of these (but not itself on the
 * list) is flagged as a likely typosquat.
 *
 * The list deliberately includes well-known *legitimate near-neighbours*
 * (e.g. `preact` next to `react`, `urllib3` next to `urllib`) so they are
 * exempted rather than falsely flagged. It is a seed, not exhaustive — extend
 * it as new high-value targets emerge.
 */
export const POPULAR_PACKAGES: Record<string, string[]> = {
  NPM: [
    'lodash', 'underscore', 'react', 'preact', 'react-dom', 'react-router', 'redux',
    'express', 'koa', 'fastify', 'axios', 'request', 'node-fetch', 'got', 'superagent',
    'chalk', 'colors', 'commander', 'yargs', 'inquirer', 'debug', 'dotenv', 'cross-env',
    'webpack', 'rollup', 'vite', 'esbuild', 'babel-core', 'typescript', 'ts-node',
    'eslint', 'prettier', 'jest', 'mocha', 'chai', 'vitest', 'sinon', 'nyc',
    'moment', 'dayjs', 'date-fns', 'uuid', 'nanoid', 'semver', 'glob', 'rimraf',
    'mkdirp', 'fs-extra', 'classnames', 'prop-types', 'styled-components', 'next',
    'vue', 'nuxt', 'angular', 'svelte', 'rxjs', 'bluebird', 'async', 'lodash.merge',
    'body-parser', 'cors', 'helmet', 'morgan', 'cookie-parser', 'multer', 'passport',
    'jsonwebtoken', 'bcrypt', 'bcryptjs', 'validator', 'joi', 'zod', 'yup',
    'mongoose', 'sequelize', 'knex', 'pg', 'mysql', 'mysql2', 'redis', 'ioredis',
    'socket.io', 'ws', 'nodemailer', 'winston', 'pino', 'bootstrap', 'jquery',
    'tailwindcss', 'postcss', 'sass', 'three', 'd3', 'chart.js', 'puppeteer', 'playwright',
  ],
  PYPI: [
    'requests', 'urllib3', 'urllib', 'httpx', 'aiohttp', 'certifi', 'idna', 'chardet',
    'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'scikit-learn', 'sklearn',
    'tensorflow', 'torch', 'keras', 'pillow', 'opencv-python', 'flask', 'django',
    'fastapi', 'uvicorn', 'gunicorn', 'starlette', 'tornado', 'celery', 'redis',
    'sqlalchemy', 'alembic', 'psycopg2', 'pymongo', 'boto3', 'botocore', 'click',
    'jinja2', 'markupsafe', 'pyyaml', 'cryptography', 'pyjwt', 'bcrypt', 'passlib',
    'pytest', 'tox', 'coverage', 'mock', 'six', 'setuptools', 'wheel', 'pip',
    'beautifulsoup4', 'lxml', 'scrapy', 'selenium', 'pydantic', 'attrs', 'colorama',
    'tqdm', 'rich', 'typer', 'python-dotenv', 'arrow', 'pendulum', 'loguru',
  ],
  CARGO: [
    'serde', 'serde_json', 'tokio', 'rand', 'regex', 'clap', 'reqwest', 'hyper',
    'anyhow', 'thiserror', 'log', 'env_logger', 'futures', 'async-trait', 'chrono',
    'itertools', 'rayon', 'bytes', 'tracing', 'syn', 'quote', 'libc',
  ],
  RUBYGEMS: [
    'rails', 'rake', 'bundler', 'rspec', 'devise', 'puma', 'sidekiq', 'nokogiri',
    'pg', 'mysql2', 'sinatra', 'faraday', 'rubocop', 'pry', 'minitest',
  ],
};
