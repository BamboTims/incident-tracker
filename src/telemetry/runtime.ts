import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

import type { Env } from '../config/env.js';

let sdk: NodeSDK | null = null;

export async function startTelemetry(env: Env): Promise<void> {
  if (!env.OTEL_ENABLED || env.NODE_ENV === 'test') {
    return;
  }

  if (sdk !== null) {
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    traceExporter: new ConsoleSpanExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: env.OTEL_METRIC_EXPORT_INTERVAL_MS
    }),
    instrumentations: [
      getNodeAutoInstrumentations()
    ]
  });

  await Promise.resolve(sdk.start());
}

export async function stopTelemetry(): Promise<void> {
  if (sdk === null) {
    return;
  }

  await sdk.shutdown();
  sdk = null;
}
