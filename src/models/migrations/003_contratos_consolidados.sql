-- Fase madre (documentos base hasta contrato firmado) y volumen mensual por período de pago
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS archivo_madre_consolidado_url TEXT;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS archivo_madre_consolidado_public_id TEXT;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS archivo_madre_consolidado_at TIMESTAMP;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS archivo_madre_consolidado_por VARCHAR(50);
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS archivo_madre_consolidado_size BIGINT;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS archivo_madre_consolidado_mime VARCHAR(100);

ALTER TABLE contratos_pagos ADD COLUMN IF NOT EXISTS archivo_mes_consolidado_url TEXT;
ALTER TABLE contratos_pagos ADD COLUMN IF NOT EXISTS archivo_mes_consolidado_public_id TEXT;
ALTER TABLE contratos_pagos ADD COLUMN IF NOT EXISTS archivo_mes_consolidado_at TIMESTAMP;
ALTER TABLE contratos_pagos ADD COLUMN IF NOT EXISTS archivo_mes_consolidado_por VARCHAR(50);
ALTER TABLE contratos_pagos ADD COLUMN IF NOT EXISTS archivo_mes_consolidado_size BIGINT;
ALTER TABLE contratos_pagos ADD COLUMN IF NOT EXISTS archivo_mes_consolidado_mime VARCHAR(100);
