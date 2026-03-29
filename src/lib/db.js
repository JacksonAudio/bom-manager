// ============================================================
// src/lib/db.js
// Thursday, March 12, 2026
//
// All Supabase queries live here.
// The UI never calls supabase directly — it calls these helpers.
// This makes it easy to swap the backend later without touching components.
// ============================================================

import { supabase } from './supabase.js'

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

// Throw on Supabase errors so callers can catch uniformly
function check(error, context) {
  if (error) throw new Error(`[db:${context}] ${error.message}`)
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

// Sign up with email + password
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  check(error, 'signUp')
  return data
}

// Sign in with email + password
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  check(error, 'signIn')
  return data
}

// Sign out the current session
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  check(error, 'signOut')
}

// Get current authenticated user (null if not logged in)
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Subscribe to auth state changes (login/logout)
// Returns unsubscribe function — call it on component unmount
export function onAuthChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
  return () => subscription.unsubscribe()
}

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

// Fetch all products, newest first, with creator's email
export async function fetchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchProducts')
  return data
}

// Insert a new product and return the created row
export async function createProduct({ name, color, userId, shopify_product_id, zoho_product_id, brand, import_name }) {
  const row = { name, color, created_by: userId, import_name: import_name || name };
  if (shopify_product_id) row.shopify_product_id = shopify_product_id;
  if (zoho_product_id) row.zoho_product_id = zoho_product_id;
  if (brand) row.brand = brand;
  const { data, error } = await supabase
    .from('products')
    .insert(row)
    .select()
    .single()
  check(error, 'createProduct')
  return data
}

// Update a product's name or color
export async function updateProduct(id, fields) {
  const { error } = await supabase
    .from('products')
    .update(fields)
    .eq('id', id)
  check(error, 'updateProduct')
}

// Delete a product by id (parts with this product_id become unassigned via set null FK)
export async function deleteProduct(id) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
  check(error, 'deleteProduct')
}

// ─────────────────────────────────────────────
// PARTS
// ─────────────────────────────────────────────

// Fetch all parts, ordered by created_at ascending
export async function fetchParts() {
  // Supabase defaults to 1000 rows — paginate to get ALL parts
  const all = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    check(error, 'fetchParts');
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break; // last page
    from += pageSize;
  }
  return all;
}

// Insert one part — returns the new row
export async function createPart(fields, userId) {
  const { data, error } = await supabase
    .from('parts')
    .insert({ ...fields, created_by: userId, updated_by: userId })
    .select()
    .single()
  check(error, 'createPart')
  return data
}

// Update one field (or many fields) on a part
export async function updatePart(id, fields, userId) {
  const { error } = await supabase
    .from('parts')
    .update({ ...fields, updated_by: userId })
    .eq('id', id)
  check(error, 'updatePart')
}

// Bulk update a single field on many parts at once
export async function bulkUpdateParts(ids, fields) {
  if (!ids.length) return
  const batchSize = 200
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const { error } = await supabase
      .from('parts')
      .update(fields)
      .in('id', batch)
    check(error, 'bulkUpdateParts')
  }
}

// Delete a single part by id
export async function deletePart(id) {
  const { error } = await supabase
    .from('parts')
    .delete()
    .eq('id', id)
  check(error, 'deletePart')
}

// Delete multiple parts by id array — used for bulk select delete
// Batches in groups of 100 to avoid query size limits
export async function deletePartsMany(ids) {
  if (!ids.length) return
  const batchSize = 100
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const { error } = await supabase
      .from('parts')
      .delete()
      .in('id', batch)
    check(error, 'deletePartsMany')
  }
}

// Upsert a batch of parts (used during BOM CSV import)
// Each part object must include all non-null fields.
export async function upsertParts(partsArray, userId) {
  if (!partsArray.length) return []
  const rows = partsArray.map(p => ({ ...p, created_by: userId, updated_by: userId }))
  const { data, error } = await supabase
    .from('parts')
    .insert(rows)
    .select()
  check(error, 'upsertParts')
  return data
}

// ─────────────────────────────────────────────
// API KEYS (team-shared)
// ─────────────────────────────────────────────

// Fetch all api_key rows as a plain key→value object
export async function fetchApiKeys() {
  const { data, error } = await supabase
    .from('api_keys')
    .select('key_name, key_value')
  check(error, 'fetchApiKeys')
  // Convert row array → { nexar_client_id: '...', mouser_api_key: '...', ... }
  return Object.fromEntries(data.map(r => [r.key_name, r.key_value]))
}

// Save a single api key value
export async function saveApiKey(keyName, keyValue, userId) {
  const { error } = await supabase
    .from('api_keys')
    .update({ key_value: keyValue, updated_by: userId })
    .eq('key_name', keyName)
  check(error, 'saveApiKey')
}

// Save all api keys at once (used by settings save button)
// Updates existing rows, inserts missing ones (requires INSERT RLS policy)
export async function saveAllApiKeys(keysObj, userId) {
  const { data: existing } = await supabase
    .from('api_keys')
    .select('key_name')
  const existingNames = new Set((existing || []).map(r => r.key_name))

  const updates = []
  const inserts = []

  for (const [key_name, key_value] of Object.entries(keysObj)) {
    if (key_value === undefined) continue
    if (existingNames.has(key_name)) {
      updates.push(
        supabase.from('api_keys')
          .update({ key_value: key_value ?? "", updated_by: userId })
          .eq('key_name', key_name)
      )
    } else if (key_value) {
      inserts.push({ key_name, key_value, updated_by: userId })
    }
  }

  if (updates.length) {
    const results = await Promise.all(updates)
    for (const { error } of results) check(error, 'saveAllApiKeys')
  }

  if (inserts.length) {
    const { error } = await supabase.from('api_keys').insert(inserts)
    if (error) {
      console.warn('[db] Insert api_key rows failed:', error.message)
      check(error, 'saveAllApiKeys')
    }
  }
}

// ─────────────────────────────────────────────
// REALTIME SUBSCRIPTIONS
// ─────────────────────────────────────────────

// Subscribe to live changes on the products table.
// callback(eventType, newRow, oldRow) is called on every INSERT/UPDATE/DELETE.
// Returns the channel — call channel.unsubscribe() on component unmount.
export function subscribeToProducts(callback) {
  return supabase
    .channel('products-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// Subscribe to live changes on the parts table.
export function subscribeToParts(callback) {
  return supabase
    .channel('parts-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// TEAM MEMBERS
// ─────────────────────────────────────────────

export async function fetchTeamMembers() {
  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .order('name', { ascending: true })
  check(error, 'fetchTeamMembers')
  return data
}

export async function createTeamMember(fields) {
  const { data, error } = await supabase
    .from('team_members')
    .insert(fields)
    .select()
    .single()
  check(error, 'createTeamMember')
  return data
}

export async function updateTeamMember(id, fields) {
  const { error } = await supabase
    .from('team_members')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  check(error, 'updateTeamMember')
}

export async function deleteTeamMember(id) {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('id', id)
  check(error, 'deleteTeamMember')
}

// ─────────────────────────────────────────────
// BUILD ORDERS
// ─────────────────────────────────────────────

export async function fetchBuildOrders() {
  const { data, error } = await supabase
    .from('build_orders')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchBuildOrders')
  return data
}

export async function createBuildOrder(fields, userId) {
  const { data, error } = await supabase
    .from('build_orders')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  check(error, 'createBuildOrder')
  return data
}

export async function updateBuildOrder(id, fields) {
  const { error } = await supabase
    .from('build_orders')
    .update(fields)
    .eq('id', id)
  check(error, 'updateBuildOrder')
}

export async function deleteBuildOrder(id) {
  const { error } = await supabase
    .from('build_orders')
    .delete()
    .eq('id', id)
  check(error, 'deleteBuildOrder')
}

// ─────────────────────────────────────────────
// BUILD ASSIGNMENTS
// ─────────────────────────────────────────────

export async function fetchBuildAssignments() {
  const { data, error } = await supabase
    .from('build_assignments')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchBuildAssignments')
  return data
}

export async function createBuildAssignment(fields) {
  const { data, error } = await supabase
    .from('build_assignments')
    .insert(fields)
    .select()
    .single()
  check(error, 'createBuildAssignment')
  return data
}

export async function updateBuildAssignment(id, fields) {
  const { error } = await supabase
    .from('build_assignments')
    .update(fields)
    .eq('id', id)
  check(error, 'updateBuildAssignment')
}

// ─────────────────────────────────────────────
// REALTIME — Production tables
// ─────────────────────────────────────────────

export function subscribeToTeamMembers(callback) {
  return supabase
    .channel('team-members-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

export function subscribeToBuildOrders(callback) {
  return supabase
    .channel('build-orders-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'build_orders' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

export function subscribeToBuildAssignments(callback) {
  return supabase
    .channel('build-assignments-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'build_assignments' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// PRICE HISTORY
// ─────────────────────────────────────────────

// Record a price point — skips if the latest price for this part+supplier is the same
export async function recordPrice(partId, unitPrice, supplier, source) {
  if (!partId || unitPrice == null || unitPrice <= 0) return
  const price = parseFloat(unitPrice)
  if (isNaN(price) || price <= 0) return

  // Check last recorded price for this part+supplier to avoid duplicates
  const { data: latest } = await supabase
    .from('price_history')
    .select('unit_price')
    .eq('part_id', partId)
    .eq('supplier', supplier || '')
    .order('recorded_at', { ascending: false })
    .limit(1)
  if (latest && latest.length > 0 && parseFloat(latest[0].unit_price) === price) return

  const { error } = await supabase
    .from('price_history')
    .insert({ part_id: partId, unit_price: price, supplier: supplier || '', source: source || 'manual' })
  if (error) console.error('[db:recordPrice]', error.message)
}

// Fetch all price history for a single part, newest first
export async function fetchPriceHistory(partId) {
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('part_id', partId)
    .order('recorded_at', { ascending: false })
  check(error, 'fetchPriceHistory')
  return data
}

// ─────────────────────────────────────────────
// BOM SNAPSHOTS
// ─────────────────────────────────────────────

// Save a BOM snapshot to the database
export async function saveBomSnapshot(label, snapshot, userId) {
  const { data, error } = await supabase
    .from('bom_snapshots')
    .insert({ label, snapshot, created_by: userId })
    .select()
    .single()
  check(error, 'saveBomSnapshot')
  return data
}

// Fetch all BOM snapshots, newest first, limit 50
export async function fetchBomSnapshots() {
  const { data, error } = await supabase
    .from('bom_snapshots')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  check(error, 'fetchBomSnapshots')
  return data
}

// ─────────────────────────────────────────────
// PO HISTORY
// ─────────────────────────────────────────────

// Fetch all PO history records, newest first
export async function fetchPOHistory() {
  const { data, error } = await supabase
    .from('po_history')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchPOHistory')
  return data
}

// Create a new PO history record
export async function createPORecord(fields, userId) {
  const { data, error } = await supabase
    .from('po_history')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  check(error, 'createPORecord')
  return data
}

// Find a PO by its PO number
export async function findPOByNumber(poNumber) {
  if (!poNumber) return null
  const { data, error } = await supabase
    .from('po_history')
    .select('*')
    .ilike('po_number', poNumber)
    .limit(1)
  if (error) { console.error('[db:findPOByNumber]', error.message); return null; }
  return data?.[0] || null
}

// Update a PO history record
export async function updatePORecord(id, fields) {
  const { error } = await supabase
    .from('po_history')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  check(error, 'updatePORecord')
}

// ─────────────────────────────────────────────
// TEAM MEMBER PIN LOOKUP
// ─────────────────────────────────────────────

// Look up a team member by their PIN code
export async function findTeamMemberByPin(pinCode) {
  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .eq('pin_code', pinCode)
    .eq('active', true)
    .single()
  if (error && error.code === 'PGRST116') return null // no match
  check(error, 'findTeamMemberByPin')
  return data
}

// ─────────────────────────────────────────────
// SCRAP LOG
// ─────────────────────────────────────────────

// Fetch all scrap log entries, newest first
export async function fetchScrapLog() {
  const { data, error } = await supabase
    .from('scrap_log')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchScrapLog')
  return data
}

// Insert a new scrap log entry
export async function createScrapEntry(fields) {
  const { data, error } = await supabase
    .from('scrap_log')
    .insert(fields)
    .select()
    .single()
  check(error, 'createScrapEntry')
  return data
}

// Subscribe to live changes on the scrap_log table
export function subscribeToScrapLog(callback) {
  return supabase
    .channel('scrap-log-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scrap_log' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// DEMAND CACHE
// ─────────────────────────────────────────────

export async function saveDemandCache(id, source, data) {
  const { error } = await supabase
    .from('demand_cache')
    .upsert({ id, source, data, synced_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) console.error('[db:saveDemandCache]', error.message)
}

export async function fetchDemandCache(id) {
  const { data, error } = await supabase
    .from('demand_cache')
    .select('*')
    .eq('id', id)
    .single()
  if (error && error.code !== 'PGRST116') console.error('[db:fetchDemandCache]', error.message)
  return data
}

// ─────────────────────────────────────────────
// PLAY TESTERS
// ─────────────────────────────────────────────

export async function fetchPlayTesters() {
  const { data, error } = await supabase
    .from('play_testers')
    .select('*')
    .order('name', { ascending: true })
  check(error, 'fetchPlayTesters')
  return data
}

export async function createPlayTester(fields) {
  const { data, error } = await supabase
    .from('play_testers')
    .insert(fields)
    .select()
    .single()
  check(error, 'createPlayTester')
  return data
}

export async function updatePlayTester(id, fields) {
  const { error } = await supabase
    .from('play_testers')
    .update(fields)
    .eq('id', id)
  check(error, 'updatePlayTester')
}

export async function deletePlayTester(id) {
  const { error } = await supabase
    .from('play_testers')
    .delete()
    .eq('id', id)
  check(error, 'deletePlayTester')
}

// ─────────────────────────────────────────────
// PLAY TESTS
// ─────────────────────────────────────────────

export async function fetchPlayTests() {
  const { data, error } = await supabase
    .from('play_tests')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchPlayTests')
  return data
}

export async function createPlayTest(fields, userId) {
  const { data, error } = await supabase
    .from('play_tests')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  check(error, 'createPlayTest')
  return data
}

export async function updatePlayTest(id, fields) {
  const { error } = await supabase
    .from('play_tests')
    .update(fields)
    .eq('id', id)
  check(error, 'updatePlayTest')
}

export async function deletePlayTest(id) {
  const { error } = await supabase
    .from('play_tests')
    .delete()
    .eq('id', id)
  check(error, 'deletePlayTest')
}

// ─────────────────────────────────────────────
// REALTIME — Play Testing tables
// ─────────────────────────────────────────────

export function subscribeToPlayTesters(callback) {
  return supabase
    .channel('play-testers-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'play_testers' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

export function subscribeToPlayTests(callback) {
  return supabase
    .channel('play-tests-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'play_tests' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// BOXING TASKS
// ─────────────────────────────────────────────

export async function fetchBoxingTasks() {
  const { data, error } = await supabase
    .from('boxing_tasks')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchBoxingTasks')
  return data
}

export async function createBoxingTask(fields, userId) {
  const { data, error } = await supabase
    .from('boxing_tasks')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  check(error, 'createBoxingTask')
  return data
}

export async function updateBoxingTask(id, fields) {
  const { error } = await supabase
    .from('boxing_tasks')
    .update(fields)
    .eq('id', id)
  check(error, 'updateBoxingTask')
}

export async function deleteBoxingTask(id) {
  const { error } = await supabase
    .from('boxing_tasks')
    .delete()
    .eq('id', id)
  check(error, 'deleteBoxingTask')
}

export function subscribeToBoxingTasks(callback) {
  return supabase
    .channel('boxing-tasks-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boxing_tasks' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// PEDAL UNITS (individual serialized units)
// ─────────────────────────────────────────────

export async function fetchPedalUnits() {
  const all = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('pedal_units')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    check(error, 'fetchPedalUnits');
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function createPedalUnit(fields, userId) {
  const { data, error } = await supabase
    .from('pedal_units')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  check(error, 'createPedalUnit')
  return data
}

export async function createPedalUnits(rows, userId) {
  if (!rows.length) return []
  const tagged = rows.map(r => ({ ...r, created_by: userId }))
  const { data, error } = await supabase
    .from('pedal_units')
    .insert(tagged)
    .select()
  check(error, 'createPedalUnits')
  return data
}

export async function updatePedalUnit(id, fields) {
  const { error } = await supabase
    .from('pedal_units')
    .update(fields)
    .eq('id', id)
  check(error, 'updatePedalUnit')
}

export async function deletePedalUnit(id) {
  const { error } = await supabase
    .from('pedal_units')
    .delete()
    .eq('id', id)
  check(error, 'deletePedalUnit')
}

export function subscribeToPedalUnits(callback) {
  return supabase
    .channel('pedal-units-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedal_units' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// PRODUCT REGISTRATIONS
// ─────────────────────────────────────────────

export async function fetchProductRegistrations() {
  const { data, error } = await supabase
    .from('product_registrations')
    .select('*')
    .order('registered_at', { ascending: false })
  check(error, 'fetchProductRegistrations')
  return data
}

export function subscribeToProductRegistrations(callback) {
  return supabase
    .channel('product-registrations-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'product_registrations' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// SHIPPING BOXES CONFIG
// ─────────────────────────────────────────────

export async function fetchShippingBoxesConfig() {
  const { data, error } = await supabase
    .from('shipping_boxes_config')
    .select('*')
    .order('name')
  check(error, 'fetchShippingBoxesConfig')
  return data
}

export async function createShippingBoxConfig(row) {
  const { data, error } = await supabase
    .from('shipping_boxes_config')
    .insert(row)
    .select()
    .single()
  check(error, 'createShippingBoxConfig')
  return data
}

export async function updateShippingBoxConfig(id, updates) {
  const { data, error } = await supabase
    .from('shipping_boxes_config')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  check(error, 'updateShippingBoxConfig')
  return data
}

export async function deleteShippingBoxConfig(id) {
  const { error } = await supabase
    .from('shipping_boxes_config')
    .delete()
    .eq('id', id)
  check(error, 'deleteShippingBoxConfig')
}

// ─────────────────────────────────────────────
// PRODUCT PACKAGING
// ─────────────────────────────────────────────

export async function fetchProductPackaging() {
  const { data, error } = await supabase
    .from('product_packaging')
    .select('*')
  check(error, 'fetchProductPackaging')
  return data
}

export async function upsertProductPackaging(row) {
  const { data, error } = await supabase
    .from('product_packaging')
    .upsert(row, { onConflict: 'product_id' })
    .select()
    .single()
  check(error, 'upsertProductPackaging')
  return data
}

export async function deleteProductPackaging(id) {
  const { error } = await supabase
    .from('product_packaging')
    .delete()
    .eq('id', id)
  check(error, 'deleteProductPackaging')
}

// ─────────────────────────────────────────────
// FULFILLMENTS
// ─────────────────────────────────────────────

export async function fetchFulfillments() {
  const { data, error } = await supabase
    .from('fulfillments')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchFulfillments')
  return data
}

export async function createFulfillment(row) {
  const { data, error } = await supabase
    .from('fulfillments')
    .insert(row)
    .select()
    .single()
  check(error, 'createFulfillment')
  return data
}

export async function updateFulfillment(id, updates) {
  const { data, error } = await supabase
    .from('fulfillments')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  check(error, 'updateFulfillment')
  return data
}

export async function deleteFulfillment(id) {
  const { error } = await supabase
    .from('fulfillments')
    .delete()
    .eq('id', id)
  check(error, 'deleteFulfillment')
}

// ─────────────────────────────────────────────
// SHIPMENT BOXES
// ─────────────────────────────────────────────

export async function fetchShipmentBoxes(fulfillmentId) {
  const q = supabase
    .from('shipment_boxes')
    .select('*, box_items(*)')
    .order('box_number')
  if (fulfillmentId) q.eq('fulfillment_id', fulfillmentId)
  const { data, error } = await q
  check(error, 'fetchShipmentBoxes')
  return data
}

export async function fetchShipmentBoxByQrToken(token) {
  const { data, error } = await supabase
    .from('shipment_boxes')
    .select('*, fulfillments(*), box_items(*, pedal_units(*, products(*)))')
    .eq('qr_token', token)
    .single()
  check(error, 'fetchShipmentBoxByQrToken')
  return data
}

export async function createShipmentBox(row) {
  const { data, error } = await supabase
    .from('shipment_boxes')
    .insert(row)
    .select()
    .single()
  check(error, 'createShipmentBox')
  return data
}

export async function updateShipmentBox(id, updates) {
  const { data, error } = await supabase
    .from('shipment_boxes')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  check(error, 'updateShipmentBox')
  return data
}

export async function deleteShipmentBox(id) {
  const { error } = await supabase
    .from('shipment_boxes')
    .delete()
    .eq('id', id)
  check(error, 'deleteShipmentBox')
}

// ─────────────────────────────────────────────
// BOX ITEMS
// ─────────────────────────────────────────────

export async function fetchBoxItems(boxId) {
  const { data, error } = await supabase
    .from('box_items')
    .select('*, pedal_units(*, products(*))')
    .eq('box_id', boxId)
  check(error, 'fetchBoxItems')
  return data
}

export async function createBoxItems(rows) {
  const { data, error } = await supabase
    .from('box_items')
    .insert(rows)
    .select()
  check(error, 'createBoxItems')
  return data
}

export async function updateBoxItem(id, updates) {
  const { data, error } = await supabase
    .from('box_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  check(error, 'updateBoxItem')
  return data
}

export async function deleteBoxItem(id) {
  const { error } = await supabase
    .from('box_items')
    .delete()
    .eq('id', id)
  check(error, 'deleteBoxItem')
}

// ─────────────────────────────────────────────
// SUBSCRIPTIONS — Fulfillment tables
// ─────────────────────────────────────────────

export function subscribeToFulfillments(callback) {
  return supabase
    .channel('fulfillments-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fulfillments' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

export function subscribeToShipmentBoxes(callback) {
  return supabase
    .channel('shipment-boxes-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shipment_boxes' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

export function subscribeToBoxItems(callback) {
  return supabase
    .channel('box-items-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'box_items' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// DEALERS
// ─────────────────────────────────────────────

export async function fetchDealers() {
  const { data, error } = await supabase
    .from('dealers')
    .select('*')
    .order('name')
  check(error, 'fetchDealers')
  return data
}

export async function createDealer(row) {
  const { data, error } = await supabase
    .from('dealers')
    .insert(row)
    .select()
    .single()
  check(error, 'createDealer')
  return data
}

export async function updateDealer(id, updates) {
  const { data, error } = await supabase
    .from('dealers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  check(error, 'updateDealer')
  return data
}

export async function deleteDealer(id) {
  const { error } = await supabase
    .from('dealers')
    .delete()
    .eq('id', id)
  check(error, 'deleteDealer')
}

// ─────────────────────────────────────────────
// SHOP ORDERS (PCB + Sheet Metal)
// ─────────────────────────────────────────────

export async function fetchShopOrders() {
  const { data, error } = await supabase
    .from('shop_orders')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchShopOrders')
  return data
}

export async function createShopOrder(row) {
  const { data, error } = await supabase
    .from('shop_orders')
    .insert(row)
    .select()
    .single()
  check(error, 'createShopOrder')
  return data
}

export async function updateShopOrder(id, updates) {
  const { data, error } = await supabase
    .from('shop_orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  check(error, 'updateShopOrder')
  return data
}

export async function deleteShopOrder(id) {
  const { error } = await supabase
    .from('shop_orders')
    .delete()
    .eq('id', id)
  check(error, 'deleteShopOrder')
}

// ─────────────────────────────────────────────
// INVENTORY TRANSACTIONS
// ─────────────────────────────────────────────

// Fetch transaction history for a single part, newest first, limit 50
export async function fetchInventoryTransactions(partId) {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('*')
    .eq('part_id', partId)
    .order('created_at', { ascending: false })
    .limit(50)
  check(error, 'fetchInventoryTransactions')
  return data
}

// Insert a new transaction record
export async function createInventoryTransaction(tx) {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .insert(tx)
    .select()
    .single()
  check(error, 'createInventoryTransaction')
  return data
}

// ─────────────────────────────────────────────
// COMPONENT RESERVATIONS
// ─────────────────────────────────────────────

// Get all reservations for a build order
export async function fetchComponentReservations(buildOrderId) {
  const { data, error } = await supabase
    .from('component_reservations')
    .select('*')
    .eq('build_order_id', buildOrderId)
  check(error, 'fetchComponentReservations')
  return data
}

// Get all active reservations (across all build orders)
export async function fetchAllComponentReservations() {
  const { data, error } = await supabase
    .from('component_reservations')
    .select('*')
    .eq('status', 'active')
  check(error, 'fetchAllComponentReservations')
  return data
}

// Bulk insert reservations for a build order
export async function createComponentReservations(buildOrderId, reservations, userId) {
  if (!reservations.length) return []
  const rows = reservations.map(r => ({
    build_order_id: buildOrderId,
    part_id: r.part_id,
    reserved_qty: r.reserved_qty,
    consumed_qty: 0,
    status: 'active',
    created_by: userId,
  }))
  const { data, error } = await supabase
    .from('component_reservations')
    .insert(rows)
    .select()
  check(error, 'createComponentReservations')
  return data
}

// Release all active reservations for a build order
export async function releaseComponentReservations(buildOrderId, userId) {
  const { error } = await supabase
    .from('component_reservations')
    .update({ status: 'released', released_at: new Date().toISOString(), released_by: userId })
    .eq('build_order_id', buildOrderId)
    .eq('status', 'active')
  check(error, 'releaseComponentReservations')
}

// Mark all active reservations as consumed when build completes
export async function consumeComponentReservations(buildOrderId) {
  const { error } = await supabase
    .from('component_reservations')
    .update({ status: 'consumed' })
    .eq('build_order_id', buildOrderId)
    .eq('status', 'active')
  check(error, 'consumeComponentReservations')
}

// ─────────────────────────────────────────────
// FINISHED GOODS
// ─────────────────────────────────────────────

// Get all finished goods shelf rows
export async function fetchFinishedGoods() {
  const { data, error } = await supabase
    .from('finished_goods')
    .select('*')
    .order('updated_at', { ascending: false })
  check(error, 'fetchFinishedGoods')
  return data
}

// Increment or decrement shelf count for a product
// quantityDelta: positive = add, negative = remove
export async function upsertFinishedGoods(productId, quantityDelta, userId) {
  // First try to get current row
  const { data: existing } = await supabase
    .from('finished_goods')
    .select('quantity_on_hand')
    .eq('product_id', productId)
    .single()

  const currentQty = existing?.quantity_on_hand ?? 0
  const newQty = Math.max(0, currentQty + quantityDelta)

  const { data, error } = await supabase
    .from('finished_goods')
    .upsert(
      { product_id: productId, quantity_on_hand: newQty, updated_at: new Date().toISOString(), updated_by: userId },
      { onConflict: 'product_id' }
    )
    .select()
    .single()
  check(error, 'upsertFinishedGoods')
  return data
}

// Update target/min stock for a product
export async function updateFinishedGoodsTargets(productId, fields, userId) {
  // Fetch existing row so we don't overwrite quantity_on_hand with 0
  const { data: existing } = await supabase
    .from('finished_goods')
    .select('quantity_on_hand, target_stock, min_stock')
    .eq('product_id', productId)
    .single()

  const currentQty = existing?.quantity_on_hand ?? 0

  // Null values for target/min default to 0 to avoid NOT NULL constraint errors
  const safeFields = {
    target_stock: fields.target_stock ?? existing?.target_stock ?? 0,
    min_stock:    fields.min_stock    ?? existing?.min_stock    ?? 0,
  }

  const { data, error } = await supabase
    .from('finished_goods')
    .upsert(
      { product_id: productId, quantity_on_hand: currentQty, ...safeFields, updated_at: new Date().toISOString(), updated_by: userId },
      { onConflict: 'product_id' }
    )
    .select()
    .single()
  check(error, 'updateFinishedGoodsTargets')
  return data
}

// ─────────────────────────────────────────────
// UNIT REPAIRS
// ─────────────────────────────────────────────

// Get all repair records, newest first
export async function fetchUnitRepairs() {
  const { data, error } = await supabase
    .from('unit_repairs')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchUnitRepairs')
  return data
}

// Create a new repair record
export async function createUnitRepair(repair) {
  const { data, error } = await supabase
    .from('unit_repairs')
    .insert(repair)
    .select()
    .single()
  check(error, 'createUnitRepair')
  return data
}

// Update repair status/notes
export async function updateUnitRepair(id, fields) {
  const { error } = await supabase
    .from('unit_repairs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  check(error, 'updateUnitRepair')
}

// Fetch all price history (for product-level rollups)
export async function fetchAllPriceHistory() {
  const all = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('price_history')
      .select('*')
      .order('recorded_at', { ascending: false })
      .range(from, from + pageSize - 1);
    check(error, 'fetchAllPriceHistory');
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
