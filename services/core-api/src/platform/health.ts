import type { Express } from 'express';

/**
 * Dua endpoint berbeda, sengaja.
 *
 *   /health/live  — proses hidup. Dipakai Kubernetes livenessProbe.
 *   /health/ready — siap menerima lalu lintas: DB dan Redis terjangkau.
 *                   Dipakai readinessProbe.
 *
 * Menyatukan keduanya adalah kesalahan klasik: saat DB sesaat terganggu,
 * liveness ikut gagal dan Kubernetes membunuh pod yang sebenarnya sehat,
 * memperparah gangguan alih-alih meredakannya.
 */
export function registerHealthRoutes(app: Express, deps: { serviceName: string }): void {
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'live', service: deps.serviceName });
  });

  app.get('/health/ready', (_req, res) => {
    // TODO Fase 1: cek koneksi PostgreSQL dan Redis di sini.
    res.json({ status: 'ready', service: deps.serviceName });
  });
}
