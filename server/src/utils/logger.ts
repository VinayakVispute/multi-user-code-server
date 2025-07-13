import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { Request } from "express";

interface LogContext {
  requestId: string;
  functionName?: string;
  userId?: string;
  [key: string]: any;
}

// Define custom colors for each log level
const customColors = {
  error: "red",
  warn: "yellow",
  info: "cyan",
  debug: "magenta",
};

// Register these colors with Winston
winston.addColors(customColors);

// Development console: colorize + timestamp + custom printf
const devConsoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// File format: timestamp + custom printf
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

class Logger {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: "debug",
      transports: [
        // General logs with daily rotation
        new DailyRotateFile({
          filename: "logs/app-%DATE%.log",
          datePattern: "YYYY-MM-DD",
          maxSize: "20m",
          maxFiles: "14d",
          level: "debug",
          format: fileFormat,
        }),

        // Error logs with daily rotation
        new DailyRotateFile({
          filename: "logs/error-%DATE%.log",
          datePattern: "YYYY-MM-DD",
          maxSize: "20m",
          maxFiles: "30d",
          level: "error",
          format: fileFormat,
        }),

        // Console output
        new winston.transports.Console({
          level: process.env.NODE_ENV === "production" ? "info" : "debug",
          format: devConsoleFormat,
        }),
      ],
    });
  }

  debug(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    this.logger.debug(logMessage);
  }

  info(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    this.logger.info(logMessage);
  }

  warn(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    this.logger.warn(logMessage);
  }

  error(message: string, data?: any) {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    this.logger.error(logMessage);
  }

  // Helper method to extract requestId from Express request
  getRequestId(req: Request): string {
    return (
      (req.headers["x-request-id"] as string) ||
      (req.headers["request-id"] as string) ||
      (req as any)?.id ||
      Math.random().toString(36).substr(2, 9)
    );
  }

  // Helper method to get userId from request
  getUserId(req: Request): string | undefined {
    return (req as any).auth?.userId || (req as any).user?.id;
  }
}

// Create and export singleton instance
const logger = new Logger();
export default logger;

// Export types for convenience
export type { LogContext };
