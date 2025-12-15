/**
 * Docker Service - Manages app containers using Docker Compose
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';

const execAsync = promisify(exec);

export class DockerService {
    private appsDir = '/apps';

    /**
     * Create and start a container for an app
     */
    async createAppContainer(appId: number, port: number): Promise<void> {
        const appDir = path.join(this.appsDir, `app-${appId}`);

        console.log(`[Docker] Creating container for app ${appId} on port ${port}`);

        // Create docker-compose.yml for this app
        const composeContent = `version: '3.8'
services:
  app-${appId}:
    build:
      context: ${appDir}
      dockerfile: /app/app.Dockerfile
    container_name: dyad-app-${appId}
    ports:
      - "${port}:3000"
    networks:
      - dyad-network
    restart: unless-stopped
    environment:
      - NODE_ENV=development

networks:
  dyad-network:
    external: true
`;

        await fs.writeFile(
            path.join(appDir, 'docker-compose.yml'),
            composeContent
        );

        // Start the container
        try {
            await execAsync(`docker-compose -f ${appDir}/docker-compose.yml up -d`, {
                cwd: appDir
            });
            console.log(`[Docker] ✅ Container dyad-app-${appId} started on port ${port}`);
        } catch (error) {
            console.error(`[Docker] ❌ Failed to start container:`, error);
            throw error;
        }
    }

    /**
     * Stop and remove an app container
     */
    async stopAppContainer(appId: number): Promise<void> {
        const appDir = path.join(this.appsDir, `app-${appId}`);

        console.log(`[Docker] Stopping container for app ${appId}`);

        try {
            await execAsync(`docker-compose -f ${appDir}/docker-compose.yml down`, {
                cwd: appDir
            });
            console.log(`[Docker] ✅ Container dyad-app-${appId} stopped`);
        } catch (error) {
            console.error(`[Docker] ❌ Failed to stop container:`, error);
            throw error;
        }
    }

    /**
     * Check if an app container is running
     */
    async getContainerStatus(appId: number): Promise<boolean> {
        try {
            const { stdout } = await execAsync(
                `docker ps --filter "name=dyad-app-${appId}" --format "{{.Status}}"`
            );
            return stdout.trim().includes('Up');
        } catch {
            return false;
        }
    }

    /**
     * Get logs from an app container
     */
    async getContainerLogs(appId: number, lines: number = 100): Promise<string> {
        try {
            const { stdout } = await execAsync(
                `docker logs dyad-app-${appId} --tail ${lines}`
            );
            return stdout;
        } catch (error) {
            console.error(`[Docker] Failed to get logs:`, error);
            return '';
        }
    }

    /**
     * Restart an app container
     */
    async restartAppContainer(appId: number): Promise<void> {
        const appDir = path.join(this.appsDir, `app-${appId}`);

        console.log(`[Docker] Restarting container for app ${appId}`);

        try {
            await execAsync(`docker-compose -f ${appDir}/docker-compose.yml restart`, {
                cwd: appDir
            });
            console.log(`[Docker] ✅ Container dyad-app-${appId} restarted`);
        } catch (error) {
            console.error(`[Docker] ❌ Failed to restart container:`, error);
            throw error;
        }
    }
}
