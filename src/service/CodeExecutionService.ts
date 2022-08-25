import * as errors from './errors';
import * as entity from '../entity';
import * as jobQueue from '../job-queue';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Job } from 'bullmq';
import util from 'util';
import path from 'path';

const exec = util.promisify(require('child_process').exec);

export class CodeExecutionService {

    private static instance: CodeExecutionService;
    private static hasAddedWorker: boolean = false;
    private supportedLanguages = new Set(["c", "cpp", "python", "java"]);
    private constructor() {}

     // follows the singleton pattern
     public static getInstance(): CodeExecutionService {

        if (!CodeExecutionService.instance) {
            CodeExecutionService.instance = new CodeExecutionService();
        }

        if (!CodeExecutionService.hasAddedWorker) {
            jobQueue.addWorker(CodeExecutionService.instance.job);
            CodeExecutionService.hasAddedWorker = true;
        }

        return CodeExecutionService.instance;
    }

    public runCode(code: string, language: string, testCases: entity.TestCase[]) {
        try {
            if (!this.supportedLanguages.has(language)) {
                throw new errors.ErrUnsupportedLanguage;
            }
            // appending the "job-" prefix to the uuid can help
            // in differentiating the uuid from our session-ids during debugging
            const jobId = `job-${uuidv4()}`;
            jobQueue.addJob(jobId, {
                code, language, testCases
            });
            return jobId;
        } catch (err) {
            throw err;
        }
    }

    public job = async(job: Job) => {
        try {
            const data: entity.JobQueueData = job.data;
            const jobId = job.name;
            const executionAreaPath = `./execution-area`;
            const directoryPath = `${executionAreaPath}/${jobId}`;
            const submissionfileName = `submission.${this.getExtension(data.language)}`;
            const inputFileName = "input.txt";
            const dockerFileParent = (process.env.NODE_ENV === 'test') ? `./src` : `./build`;
            const dockerFilePath = `${dockerFileParent}/dockerfiles/${data.language}`;
            const submissionFilePath = path.resolve(`${directoryPath}/${submissionfileName}`);
            const inputFilePath = path.resolve(`${directoryPath}/${inputFileName}`);
            const outputFilePath =  path.resolve(`${directoryPath}/output.txt`);

            await job.updateProgress(entity.JobProgress.STARTED);
            await fs.promises.mkdir(directoryPath);
            await fs.promises.mkdir(`${directoryPath}/outputs`);
            await fs.promises.writeFile(submissionFilePath, data.code, {
                encoding: 'utf-8'
            });
            await fs.promises.writeFile(inputFilePath, this.getFileContent(data.testCases, true), {
                encoding: 'utf-8'
            });
            await fs.promises.writeFile(outputFilePath, this.getFileContent(data.testCases, false), {
                encoding: 'utf-8'
            });
            await job.updateProgress(entity.JobProgress.MKDIR);
            await exec(`docker build -t ${jobId} -f ${dockerFilePath} --build-arg SUBMISSION_FILE_PATH=${jobId}/${submissionfileName} --build-arg INPUT_FILE_PATH=${jobId}/${inputFileName} ${executionAreaPath}`);
            await job.updateProgress(entity.JobProgress.DOCKER_BUILD);
            await exec(`docker run -v ${path.resolve(directoryPath)}/outputs:/outputs ${jobId}`);
            await job.updateProgress(entity.JobProgress.DOCKER_RUN);
            await exec(`docker rmi -f ${jobId}`);
            await job.updateProgress(entity.JobProgress.DOCKER_RMI);
            await this.processOutputs(jobId, data.testCases);
            await job.updateProgress(entity.JobProgress.PROCESS_OUTPUTS);
            await fs.promises.rm(directoryPath, {
                recursive: true,
                force: true
            });
            await job.updateProgress(entity.JobProgress.RM);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }
    
    private getExtension(language: string): string {
        if (language === "python") {
            return "py";
        }
        return language;
    }

    private getFileContent(testCases: entity.TestCase[], writeInput: boolean): string {
        let result = `${testCases.length}\n`;
        for (let i = 0; i < testCases.length; ++i) {
            result += (writeInput) ? `${testCases[i].input}\n` : `${testCases[i].output}\n`;
        }
        return result;
    }

    private async processOutputs(jobId: string, testCases: entity.TestCase[]) {
        
    }

    public async getJobResult(jobId: string) {

    }
}