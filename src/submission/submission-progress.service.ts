import { Injectable, Logger } from "@nestjs/common";
import { Redis } from "ioredis";

import { SubmissionProgress, SubmissionProgressType } from "./submission-progress.interface";
import { RedisService } from "@/redis/redis.service";
import { SubmissionProgressGateway } from "./submission-progress.gateway";

const REDIS_KEY_SUBMISSION_PROGRESS = "submissionProgress_";
const REDIS_CHANNEL_SUBMISSION_PROGRESS = "submissionProgress";

// The process for after a progress received:
// 1. If its type is "Finished", it's converted to a "result" and stored to the database,
//    anything related to the submission will be updated, its previous progress will be removed from Redis.
//    Otherwise (non-finished) the progress is stored to Redis.
// 2. A message is published to other all clusters to tell all clusters about the progress.
// 3. Once a cluster recived the Redis message of progress, it will lookup for its clients who has subscribed
//    the submission's progress and send them the progress via WebSocket.
@Injectable()
export class SubmissionProgressService {
  private readonly redisSubscribe: Redis;
  private readonly redis: Redis;

  constructor(
    private readonly redisService: RedisService,
    private readonly submissionProgressGateway: SubmissionProgressGateway
  ) {
    this.redis = this.redisService.getClient();
    this.redisSubscribe = this.redisService.getClient();

    this.redisSubscribe.on("message", (channel: string, message: string) => {
      const { submissionId, canceled, progress } = JSON.parse(message);
      this.consumeSubmissionProgress(submissionId, canceled, progress);
    });
    this.redisSubscribe.subscribe(REDIS_CHANNEL_SUBMISSION_PROGRESS);
  }

  private async consumeSubmissionProgress(submissionId: number, canceled: boolean, progress?: SubmissionProgress) {
    Logger.log("Consume progress for submission " + submissionId);
    this.submissionProgressGateway.onSubmissionProgress(submissionId, canceled, progress);
  }

  // If the progress type is "Finished", this method is called after the progress
  // result is stored in the database.
  public async onSubmissionProgressReported(
    submissionId: number,
    canceled: boolean,
    progress?: SubmissionProgress
  ): Promise<void> {
    Logger.log(`Progress for submission ${submissionId} received, pushing to Redis`);
    if (canceled || progress.progressType === SubmissionProgressType.Finished) {
      await this.redis.del(REDIS_KEY_SUBMISSION_PROGRESS + submissionId);
    } else {
      await this.redis.set(REDIS_KEY_SUBMISSION_PROGRESS + submissionId, JSON.stringify(progress));
    }

    // This will call this.consumeSubmissionProgress
    await this.redis.publish(
      REDIS_CHANNEL_SUBMISSION_PROGRESS,
      JSON.stringify({
        submissionId: submissionId,
        canceled: canceled,
        progress: progress
      })
    );
  }

  public async getSubmissionProgress(submissionId: number): Promise<SubmissionProgress> {
    const str = await this.redis.get(REDIS_KEY_SUBMISSION_PROGRESS + submissionId);
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  }
}
