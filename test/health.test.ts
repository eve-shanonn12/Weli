import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('HTTP API', () => {
  afterEach(async () => {
    // Each test creates and closes its own Fastify instance.
  });

  it('exposes a health endpoint', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'welilink-market-api' });

    await app.close();
  });

  it('exposes the curated product showcase and only serves registered image assets', async () => {
    const app = await buildApp();
    const showcase = await app.inject({ method: 'GET', url: '/api/showcase-products' });
    const image = await app.inject({ method: 'GET', url: '/assets/products/arachide.jpg' });
    const unknownImage = await app.inject({ method: 'GET', url: '/assets/products/not-a-product.jpg' });

    expect(showcase.statusCode).toBe(200);
    expect(showcase.json().products).toHaveLength(17);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(unknownImage.statusCode).toBe(404);

    await app.close();
  });

  it('exposes the producer photo form and product detail shell', async () => {
    const app = await buildApp();
    const producerPage = await app.inject({ method: 'GET', url: '/producteur' });
    const detailPage = await app.inject({ method: 'GET', url: '/produit/example-product' });

    expect(producerPage.statusCode).toBe(200);
    expect(producerPage.body).toContain('Photo du produit');
    expect(producerPage.body).toContain('multipart/form-data');
    expect(detailPage.statusCode).toBe(200);
    expect(detailPage.body).toContain('Chargement de la fiche produit');

    await app.close();
  });

  it('exposes the order page and removes the retired payment page', async () => {
    const app = await buildApp();
    const orderPage = await app.inject({ method: 'GET', url: '/commande' });
    const retiredPaymentPage = await app.inject({ method: 'GET', url: '/paiement' });

    expect(orderPage.statusCode).toBe(200);
    expect(orderPage.body).toContain('Valider et continuer sur WhatsApp');
    expect(orderPage.body).toContain('wa.me/237670785644');
    expect(orderPage.body).not.toContain('${protectedGuard}');
    expect(orderPage.body).toContain('Producteur(s)');
    expect(orderPage.body).toContain('Référence(s) Weli-Link');
    expect(retiredPaymentPage.statusCode).toBe(404);

    await app.close();
  });
});
