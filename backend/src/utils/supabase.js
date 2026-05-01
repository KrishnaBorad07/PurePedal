const { createClient } = require("@supabase/supabase-js");
const config = require("../config");

const anonClient = createClient(config.supabase.url, config.supabase.anonKey);

const adminClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey
);

module.exports = { anonClient, adminClient };
