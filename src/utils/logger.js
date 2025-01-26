import winston from "winston";

const consoleFormat = winston.format.printf(({ level, message }) => {
	return `${level}: ${message}`;
});

export const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || "debug",
	transports: [
		// File transports with full details
		new winston.transports.File({
			filename: "logs/error.log",
			level: "error",
			format: winston.format.combine(
				winston.format.timestamp(),
				winston.format.json()
			),
		}),
		new winston.transports.File({
			filename: "logs/combined.log",
			format: winston.format.combine(
				winston.format.timestamp(),
				winston.format.json()
			),
		}),
		// Console transport with minimal output
		new winston.transports.Console({
			format: winston.format.combine(winston.format.colorize(), consoleFormat),
		}),
	],
});
