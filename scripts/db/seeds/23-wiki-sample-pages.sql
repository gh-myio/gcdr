-- =============================================================================
-- SEED: WIKI SAMPLE PAGES — MYIO Company Documentation (RFC-0030)
-- =============================================================================
-- Creates a namespace `General` and 5 sample wiki pages (visibility = PUBLIC,
-- status = PUBLISHED) derived from
-- `thingsboard_repo.git/widget_type/MYIO/docs/MYIO-Company-Documentation.md`.
--
-- Everything is idempotent — re-running is safe.
-- =============================================================================

DO $$
DECLARE
    v_tenant_id  UUID := '11111111-1111-1111-1111-111111111111';
    v_admin_id   UUID := 'bbbb1111-1111-1111-1111-111111111111';

    v_page_id    UUID;
    v_rev_id     UUID;

    -- Page bodies — kept Markdown exactly as in the source document.
    v_body_overview      TEXT;
    v_body_features      TEXT;
    v_body_use_cases     TEXT;
    v_body_differentiat  TEXT;
    v_body_technical     TEXT;

    v_html_placeholder   TEXT;
BEGIN
    -- -------------------------------------------------------------------------
    -- Namespace
    -- -------------------------------------------------------------------------
    INSERT INTO wiki_namespaces (tenant_id, name, description, review_required)
    VALUES (
        v_tenant_id,
        'General',
        'Institutional and cross-cutting documentation about MYIO.',
        false
    )
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- -------------------------------------------------------------------------
    -- Page bodies
    -- -------------------------------------------------------------------------
    v_body_overview := E'# MYIO – Intelligent IoT & Automation Platform\n\n' ||
E'## Executive Summary\n\n' ||
E'MYIO is a technology company specialized in IoT, telemetry, and intelligent automation, building a robust ecosystem that connects devices, sensors, and hubs through a mesh offline-first architecture, ensuring resilience, reliability, and operational efficiency.\n\n' ||
E'Operating across shopping malls, industries, hospitals, residential buildings, and smart cities, MYIO delivers solutions that combine stable connectivity, modern dashboards, and advanced automation, simplifying the management of energy, water, climate, and security.\n\n' ||
E'## Value Proposition\n\n' ||
E'- **Operational Efficiency**: intelligent automation that reduces costs.\n' ||
E'- **Offline-First Resilience**: continuous operation without internet.\n' ||
E'- **Scalability**: hundreds of devices per central hub.\n' ||
E'- **Sustainability**: efficient use of energy and water.\n' ||
E'- **Continuous Innovation**: proprietary, evolving technology.\n\n' ||
E'## Conclusion\n\n' ||
E'MYIO transforms physical environments into intelligent, connected, and sustainable ecosystems.\n\n' ||
E'From shopping malls and industrial plants to hospitals and cities, we deliver reliability, intelligent automation, and centralized management, bridging the gap between the physical and digital worlds with efficiency, security, and innovation.\n\n' ||
E'See also:\n' ||
E'- [Features & Benefits](/wiki/p/General/features-and-benefits)\n' ||
E'- [Use Cases](/wiki/p/General/use-cases)\n' ||
E'- [MYIO Differentiators](/wiki/p/General/differentiators)\n' ||
E'- [Technical Overview](/wiki/p/General/technical-overview)\n';

    v_body_features := E'# Features & Benefits\n\n' ||
E'## Scalable Mesh Network\n\n' ||
E'- Supports 100–200 devices per central hub.\n' ||
E'- Radio-based communication (resistant to Wi-Fi / 3G / 4G / 5G interference).\n' ||
E'- Coverage for entire environments (e.g., a full shopping-mall floor).\n\n' ||
E'## Offline-First Architecture\n\n' ||
E'- Devices store data locally.\n' ||
E'- Mesh network keeps operating even without internet.\n' ||
E'- Automatic synchronization once the connection is restored.\n\n' ||
E'## 360° Real-Time Monitoring\n\n' ||
E'- **Energy**: consumption, demand, peaks, smart switching.\n' ||
E'- **Water**: flow, meters, solenoid/valve automation to prevent leaks.\n' ||
E'- **Climate**: real-time temperature and humidity sensors.\n' ||
E'- **Security**: presence, motion, door and window sensors.\n\n' ||
E'## Intelligent Automation\n\n' ||
E'- Remote and scheduled equipment control.\n' ||
E'- Smart demand management to prevent overloads.\n' ||
E'- Automated HVAC and refrigeration control.\n\n' ||
E'## Dashboards & Management\n\n' ||
E'- Real-time dashboards for energy, water, climate, and security.\n' ||
E'- Intelligent alarms and automated responses.\n' ||
E'- Historical charts, comparative analysis, and customizable reports.\n\n' ||
E'## Reliability & Stability\n\n' ||
E'- High-availability radio mesh.\n' ||
E'- Distributed local storage for data safety.\n' ||
E'- Continuous operation even in critical environments.\n';

    v_body_use_cases := E'# Use Cases\n\n' ||
E'MYIO serves a wide spectrum of physical environments. Each deployment is tuned to the site''s operational priorities.\n\n' ||
E'## Shopping Malls & Commercial Centers\n\n' ||
E'Centralized energy and water monitoring across stores, common areas, and technical rooms. Predictive alarms for refrigeration racks and HVAC units keep tenant operations running and maintenance reactive only when strictly needed.\n\n' ||
E'## Industrial Plants\n\n' ||
E'Process instrumentation plus production-line automation. The mesh network survives when the corporate Wi-Fi or 4G link drops — critical data keeps flowing and actuators keep responding.\n\n' ||
E'## Hospitals & Critical Environments\n\n' ||
E'Temperature control on pharmaceutical refrigerators, pressure monitoring in clean rooms, and real-time alerts for power-quality incidents. The offline-first architecture is especially valuable where downtime is not an option.\n\n' ||
E'## Condominiums & Smart Buildings\n\n' ||
E'Unified energy, water, and security management for common areas and individual units. Residents and managers access dashboards tailored to their role.\n\n' ||
E'## Smart Cities\n\n' ||
E'Street-scale telemetry — public lighting, water distribution, environmental sensing — delivered over the same mesh + ingestion stack used in private deployments.\n';

    v_body_differentiat := E'# MYIO Differentiators\n\n' ||
E'What sets MYIO apart from conventional IoT stacks:\n\n' ||
E'- **Offline-first design** for maximum resilience — devices and hubs keep operating and storing data when the uplink is down.\n' ||
E'- **Scalable mesh network** ensuring stable connectivity over entire buildings without relying on customer-provided Wi-Fi.\n' ||
E'- **Custom dashboards** tailored to each client''s role mix (operations, facilities, tenants, executives).\n' ||
E'- **Operational cost reduction** through automation and predictive alarms — fewer truck rolls, earlier interventions.\n' ||
E'- **Flexibility** to integrate new sensors and devices as the mesh already speaks multiple protocols and the hub software is extensible via Node-RED flows.\n\n' ||
E'## Roadmap Highlights\n\n' ||
E'- Expansion into smart-city integrations.\n' ||
E'- Machine learning for predictive maintenance and optimization.\n' ||
E'- Open APIs for third-party integrations.\n' ||
E'- Advanced dashboards with 3D / AR visualizations.\n';

    v_body_technical := E'# Technical Overview\n\n' ||
E'## Hardware Architecture\n\n' ||
E'### IoT Devices\n\n' ||
E'Relays, switches, temperature & humidity sensors, water flow meters, presence and door/window sensors — all communicating over the MYIO mesh.\n\n' ||
E'### Mesh Network\n\n' ||
E'Radio-based communication across devices. Resilient to Wi-Fi and cellular interference; coverage is engineered per site.\n\n' ||
E'### Central Hub (Orange Pi)\n\n' ||
E'- Embedded Linux OS.\n' ||
E'- Postgres + TimescaleDB.\n' ||
E'- Node-RED for automation, data conversion, scheduling, and delivery.\n' ||
E'- Embedded React Native app for device registration and monitoring.\n\n' ||
E'## Data Flow\n\n' ||
E'1. Devices communicate via mesh network to the hub.\n' ||
E'2. Hub processes data (multipliers, conversions, setpoints).\n' ||
E'3. Telemetry is sent via MQTT to:\n' ||
E'   - **ThingsBoard** → management, alarms, dashboards, reports.\n' ||
E'   - **Data Ingestion API** → high-reliability data repository (handles outliers/gaps).\n\n' ||
E'## Platforms & Software\n\n' ||
E'### ThingsBoard\n\n' ||
E'- Backend: Java.\n' ||
E'- Frontend: Angular.\n' ||
E'- Handles alarms, dashboards, user profiles, reports.\n\n' ||
E'### Node-RED\n\n' ||
E'- Data processing and automation logic.\n' ||
E'- Integrations with APIs and schedulers.\n\n' ||
E'### Data Ingestion API\n\n' ||
E'- Primary storage of telemetry.\n' ||
E'- Outlier and gap handling.\n' ||
E'- Reliable repository for energy, water, climate, and humidity data.\n\n' ||
E'## Security\n\n' ||
E'- Local redundant storage.\n' ||
E'- Role-based access and user profiles (ThingsBoard).\n' ||
E'- Active monitoring of mesh connectivity and device health.\n\n' ||
E'## Technology Stack\n\n' ||
E'- **Hardware**: Orange Pi, energy/water/climate/security sensors.\n' ||
E'- **Database**: Postgres + TimescaleDB.\n' ||
E'- **Middleware**: Node-RED.\n' ||
E'- **Protocols**: MQTT, mesh radio.\n' ||
E'- **Frontend**: React Native (hub app), Angular (ThingsBoard).\n' ||
E'- **Backend**: Java (ThingsBoard), Node.js (Data Ingestion, APIs).\n';

    -- -------------------------------------------------------------------------
    -- Helper-ish inline: insert page -> insert revision -> update page pointer.
    -- Each page is wrapped in a NOT EXISTS guard so the seed is idempotent.
    -- (A DO block cannot define functions, so we repeat the 3-step pattern.)
    -- -------------------------------------------------------------------------

    -- 1) Executive Summary — slug: overview (landing page for /wiki/p)
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'General' AND slug = 'overview'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_overview,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'General', 'overview',
            'MYIO — Intelligent IoT & Automation Platform',
            'PUBLISHED',
            NULL,
            ARRAY['myio','overview','institutional']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object(
                'owner', 'marketing@myio',
                'sourceDocVersion', '1.0',
                'sourceDocDate',    '2025-09-01'
            ),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'MYIO — Intelligent IoT & Automation Platform',
            v_body_overview, v_html_placeholder,
            jsonb_build_object('owner', 'marketing@myio'),
            'initial seed',
            v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 2) Features & Benefits — slug: features-and-benefits
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'General' AND slug = 'features-and-benefits'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_features,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'General', 'features-and-benefits',
            'Features & Benefits',
            'PUBLISHED',
            NULL,
            ARRAY['myio','features','mesh','iot','automation']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object('owner', 'product@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Features & Benefits',
            v_body_features, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 3) Use Cases — slug: use-cases
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'General' AND slug = 'use-cases'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_use_cases,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'General', 'use-cases',
            'Use Cases',
            'PUBLISHED',
            NULL,
            ARRAY['myio','use-cases','shopping','industrial','hospital','smart-city']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object('owner', 'sales@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Use Cases',
            v_body_use_cases, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 4) Differentiators — slug: differentiators
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'General' AND slug = 'differentiators'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_differentiat,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'General', 'differentiators',
            'MYIO Differentiators',
            'PUBLISHED',
            NULL,
            ARRAY['myio','differentiators','roadmap']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object('owner', 'marketing@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'MYIO Differentiators',
            v_body_differentiat, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;

    -- 5) Technical Overview — slug: technical-overview
    IF NOT EXISTS (
        SELECT 1 FROM wiki_pages
        WHERE tenant_id = v_tenant_id AND namespace = 'General' AND slug = 'technical-overview'
    ) THEN
        v_page_id := gen_random_uuid();
        v_rev_id  := gen_random_uuid();
        v_html_placeholder := '<pre class="wiki-body-placeholder">' ||
            replace(replace(replace(replace(v_body_technical,
                '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') ||
            '</pre>';

        INSERT INTO wiki_pages (
            id, tenant_id, namespace, slug, title, status,
            current_revision_id, tags, visibility, frontmatter,
            created_by, created_at, updated_at, version
        ) VALUES (
            v_page_id, v_tenant_id, 'General', 'technical-overview',
            'Technical Overview',
            'PUBLISHED',
            NULL,
            ARRAY['myio','technical','thingsboard','node-red','mqtt','postgres','timescaledb']::text[],
            ARRAY['PUBLIC']::text[],
            jsonb_build_object('owner', 'engineering@myio'),
            v_admin_id, now(), now(), 1
        );

        INSERT INTO wiki_page_revisions (
            id, page_id, revision_number, title,
            body, body_html, frontmatter, change_note, author_id, created_at
        ) VALUES (
            v_rev_id, v_page_id, 1,
            'Technical Overview',
            v_body_technical, v_html_placeholder,
            '{}'::jsonb, 'initial seed', v_admin_id, now()
        );

        UPDATE wiki_pages SET current_revision_id = v_rev_id WHERE id = v_page_id;
    END IF;
END $$;
