-- Usuario anónimo para órdenes sin auth (frontend conectado sin login)
INSERT INTO users (id, email) VALUES ('a0000000-0000-4000-8000-000000000001', 'anonymous@exury.io')
ON CONFLICT (email) DO NOTHING;
