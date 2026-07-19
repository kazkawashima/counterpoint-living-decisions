-- Synthetic preview data only. Keep these credentials documented as demo-only.
INSERT OR IGNORE INTO users (user_id, password_hash, active) VALUES
  (
    'product',
    'scrypt$v1$16384$8$1$OEwpNCxv86k8IZcEdTDf4g$n6qQBhlpokry1hjffTiNXyS3i9kgTdck1mtoYylMNNc',
    1
  ),
  (
    'safety',
    'scrypt$v1$16384$8$1$mNoCK6EpZlTEErwXPN04ew$k2CJzod-vSBkJOeHfl0DYZRC8JdTUiushgpMmtR99rU',
    1
  ),
  (
    'legal',
    'scrypt$v1$16384$8$1$FbFwb6-avA-vMsmHdMOoIw$i55Hu7ezBsAqgdW97XHwRaSIFRZnJpu7TyP0KDfwe4U',
    1
  ),
  (
    'engineering',
    'scrypt$v1$16384$8$1$2EL8CN_i5Ip2bygrRaYeAA$BngA7tzCOXkGWY_mg5KAygQje2Zy3LIPIDU5xLX0qks',
    1
  ),
  (
    'sales',
    'scrypt$v1$16384$8$1$os7QZZ9UEaQ03JICKECA8A$VoLeF85ItTvIzOlOFb5upvEjV2e231uLYh6as3v20ig',
    1
  );

INSERT OR IGNORE INTO meetings (
  meeting_id,
  code,
  created_by_user_id,
  facilitator_participant_id,
  purpose,
  active
) VALUES (
  'meeting-global-ai-rollout',
  'GLOBAL-AI-2026',
  'product',
  'participant-product',
  'Work & Productivity — Global AI Product Rollout',
  1
);

INSERT OR IGNORE INTO participant_assignments (
  meeting_id,
  participant_id,
  user_id,
  role,
  active
) VALUES
  (
    'meeting-global-ai-rollout',
    'participant-product',
    'product',
    'facilitator',
    1
  ),
  (
    'meeting-global-ai-rollout',
    'participant-safety',
    'safety',
    'participant',
    1
  ),
  (
    'meeting-global-ai-rollout',
    'participant-legal',
    'legal',
    'participant',
    1
  ),
  (
    'meeting-global-ai-rollout',
    'participant-engineering',
    'engineering',
    'participant',
    1
  ),
  (
    'meeting-global-ai-rollout',
    'participant-sales',
    'sales',
    'participant',
    1
  );
