import { prisma } from "@scaner-blogers/db";
import { seedDemoData } from "../../scripts/seed-demo-data";

export default async function globalSetup() {
  await seedDemoData(prisma);
  await prisma.$disconnect();
}
