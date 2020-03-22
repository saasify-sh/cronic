import pMap = require('p-map')
import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Route,
  Header
} from 'tsoa'
import { CronJob, CronJobCreateRequest, CronJobUpdateRequest } from './types'

import * as db from './db'
import * as scheduler from './scheduler'

@Route('/jobs')
export class CronJobController extends Controller {
  @Post()
  public async createJob(
    @Body() body: CronJobCreateRequest,
    @Header('x-saasify-user') userId: string
  ): Promise<CronJob> {
    console.log('createJob', { body, userId })

    const data = {
      timezone: 'America/New_York',
      httpMethod: 'GET',
      httpHeaders: {},
      name: 'Default',
      description: '',
      tags: [],
      ...body,
      userId,
      state: 'enabled'
    }

    const doc = await db.CronJobs.add(data)
    const job = await db.get<CronJob>(doc, userId)
    console.log({ job })

    const schedulerJob = await scheduler.createJob(job)
    console.log({ schedulerJob })

    return scheduler.enrichJob(job, schedulerJob)
  }

  @Get(`/{jobId}`)
  public async getJob(
    jobId: string,
    @Header('x-saasify-user') userId: string
  ): Promise<CronJob> {
    console.log('getJob', { jobId, userId })

    const doc = db.CronJobs.doc(jobId)
    const job = await db.get<CronJob>(doc, userId)

    const schedulerJob = await scheduler.getJob(job)
    console.log({ schedulerJob })

    return scheduler.enrichJob(job, schedulerJob)
  }

  @Delete(`/{jobId}`)
  public async removeJob(
    jobId: string,
    @Header('x-saasify-user') userId: string
  ): Promise<void> {
    console.log('removeJob', { jobId, userId })

    const doc = db.CronJobs.doc(jobId)
    const job = await db.get<CronJob>(doc, userId)

    await scheduler.deleteJob(job)
    await doc.delete()
  }

  @Get()
  public async listJobs(
    @Query() offset: number = 0,
    @Query() limit: number = 100,
    @Header('x-saasify-user') userId: string
  ): Promise<CronJob[]> {
    console.log('listJobs', { offset, limit, userId })

    const { docs } = await db.CronJobs.where('userId', '==', userId)
      .offset(offset)
      .limit(limit)
      .get()

    const jobs = docs.map((doc) => db.getSnapshot<CronJob>(doc))

    return pMap(
      jobs,
      async (job) => {
        const schedulerJob = await scheduler.getJob(job)
        return scheduler.enrichJob(job, schedulerJob)
      },
      {
        concurrency: 4
      }
    )
  }

  @Put(`/{jobId}`)
  public async updateJob(
    jobId: string,
    @Body() body: CronJobUpdateRequest,
    @Header('x-saasify-user') userId: string
  ): Promise<CronJob> {
    console.log('updateJob', { jobId, body, userId })

    const doc = db.CronJobs.doc(jobId)
    const snapshot = await doc.get()

    if (snapshot.exists) {
      const data = snapshot.data()

      if (data.userId === userId) {
        await doc.update(body)
        const job = await db.get<CronJob>(doc, userId)

        const schedulerJob = await scheduler.updateJob(job)
        return scheduler.enrichJob(job, schedulerJob)
      }
    }

    throw {
      message: 'Not found',
      status: 404
    }
  }
}
