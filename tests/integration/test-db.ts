import { prisma } from "@scaner-blogers/db";

export async function clearTestDatabase() {
  await prisma.collectionEvent.deleteMany();
  await prisma.collectionSearchHistory.deleteMany();
  await prisma.rawSocialSnapshot.deleteMany();
  await prisma.candidateProfile.deleteMany();
  await prisma.collectionRun.deleteMany();
  await prisma.collectionJob.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.searchKeyword.deleteMany();
  await prisma.socialPlatformAccount.deleteMany();
  await prisma.proxyEndpoint.deleteMany();
  await prisma.scanEvent.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.scanJob.deleteMany();
  await prisma.rawApiSnapshot.deleteMany();
  await prisma.creativeCountry.deleteMany();
  await prisma.creativeAsset.deleteMany();
  await prisma.creative.deleteMany();
  await prisma.app.deleteMany();
  await prisma.advertiser.deleteMany();
  await prisma.systemSettings.deleteMany();
  await prisma.user.deleteMany();
}
