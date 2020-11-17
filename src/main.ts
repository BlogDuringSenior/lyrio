import util from "util";
import cluster from "cluster";

import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Logger, ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

import getGitRepoInfo from "git-repo-info";
import moment from "moment";
import { json } from "express"; // eslint-disable-line import/no-extraneous-dependencies

import { AppModule } from "./app.module";
import { ConfigService } from "./config/config.service";
import { MigrationService } from "./migration/migration.service";
import { ErrorFilter } from "./error.filter";
import { RecaptchaFilter } from "./recaptcha.filter";
import { ClusterService } from "./cluster/cluster.service";

// eslint-disable-next-line no-extend-native
String.prototype.format = function format(...args) {
  return util.format.call(undefined, this, ...args);
};

export const appGitRepoInfo = getGitRepoInfo();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function initialize(): Promise<[packageInfo: any, configService: ConfigService, app: NestExpressApplication]> {
  // Get package info
  const packageInfo = require("../package.json"); // eslint-disable-line @typescript-eslint/no-var-requires
  const appVersion = `v${packageInfo.version}`;
  const gitRepoVersion = appGitRepoInfo.abbreviatedSha
    ? ` (Git revision ${appGitRepoInfo.abbreviatedSha} on ${moment(appGitRepoInfo.committerDate).format(
        "YYYY-MM-DD H:mm:ss"
      )})`
    : "";

  if (cluster.isMaster) Logger.log(`Starting ${packageInfo.name} version ${appVersion}${gitRepoVersion}`, "Bootstrap");

  // Create nestjs app
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...(process.env.NODE_ENV === "production" ? { logger: ["warn", "error"] } : {})
  });
  const configService = app.get(ConfigService);
  app.setGlobalPrefix("api");
  app.useGlobalFilters(app.get(ErrorFilter), app.get(RecaptchaFilter));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.use(json({ limit: "1024mb" }));
  app.set("trust proxy", configService.config.server.trustProxy);

  const options = new DocumentBuilder()
    .setTitle(packageInfo.name)
    .setDescription(packageInfo.description)
    .setVersion(appVersion)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup("/docs", app, document);

  return [packageInfo, configService, app];
}

async function runMigration(app: NestExpressApplication, migrationConfigFile: string) {
  const migrationService = app.get(MigrationService);
  await migrationService.migrate(migrationConfigFile, app);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function startApp(packageInfo: any, configService: ConfigService, app: NestExpressApplication) {
  await app.listen(configService.config.server.port, configService.config.server.hostname);
  Logger.log(
    `${packageInfo.name} is listening on ${configService.config.server.hostname}:${configService.config.server.port}`,
    "Bootstrap"
  );
}

async function bootstrap() {
  const [packageInfo, configService, app] = await initialize();

  // If the SYZOJ_NG_MIGRATION_CONFIG_FILE enviroment variable presents, start migration
  const migrationConfigFile = process.env.SYZOJ_NG_MIGRATION_CONFIG_FILE;
  if (migrationConfigFile)
    // Start migration
    await runMigration(app, migrationConfigFile);
  // Start Nest.js app
  else {
    const clusterService = app.get(ClusterService);
    await clusterService.initialization(async () => await startApp(packageInfo, configService, app));
  }
}

bootstrap().catch(err => {
  console.error(err); // eslint-disable-line no-console
  console.error("Error bootstrapping the application, exiting..."); // eslint-disable-line no-console
  process.exit(1);
});
