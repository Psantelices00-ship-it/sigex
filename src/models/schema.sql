CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  login VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  rol VARCHAR(60) NOT NULL,
  area VARCHAR(80),
  activo BOOLEAN DEFAULT true,
  ultimo_acceso TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expedientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero VARCHAR(20) UNIQUE NOT NULL,
  descripcion TEXT NOT NULL,
  solicitante VARCHAR(100) NOT NULL,
  area VARCHAR(80) NOT NULL,
  tipo_gasto VARCHAR(80),
  monto NUMERIC(14,2) DEFAULT 0,
  prioridad VARCHAR(20) DEFAULT 'Normal',
  estado VARCHAR(40) DEFAULT 'Ingresado',
  fecha_ingreso DATE,
  observaciones TEXT,
  creado_por VARCHAR(50),
  caja VARCHAR(20), estante VARCHAR(20), posicion VARCHAR(20),
  sala VARCHAR(80), fecha_archivo DATE, obs_archivo TEXT, archivado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expediente_id UUID REFERENCES expedientes(id) ON DELETE CASCADE,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(100) NOT NULL,
  formato VARCHAR(20) DEFAULT 'PDF',
  version INTEGER DEFAULT 1,
  observacion TEXT,
  file_path TEXT,
  file_size INTEGER,
  mime_type VARCHAR(100),
  cargado_por VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historial (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expediente_id UUID REFERENCES expedientes(id) ON DELETE CASCADE,
  usuario VARCHAR(50),
  accion VARCHAR(100),
  nota TEXT,
  tipo VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO usuarios (login, password_hash, nombre, rol, area) VALUES
  ('admin',       '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Administrador Sistema',   'Super Admin',                    'Administración'),
  ('secretaria',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Carmen López',            'Secretaria de Administración',   'Secretaría'),
  ('contabilidad','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Roberto Silva',           'Jefe de Contabilidad',           'Contabilidad'),
  ('compras',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Paula Morales',           'Encargado de Compras',           'Compras'),
  ('tesoreria',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Felipe Araya',            'Tesorería',                      'Tesorería'),
  ('rendicion',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Valentina Torres',        'Encargada de Rendición',         'Rendición')
ON CONFLICT (login) DO NOTHING;
