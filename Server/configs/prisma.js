import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import { neonConfig } from '@neondatabase/serverless'

import ws from 'ws'
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaNeon({ connectionString });
const prisma = globalThis.prisma || new PrismaClient({ adapter });
if(process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

export default prisma;
