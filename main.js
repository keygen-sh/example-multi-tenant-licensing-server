const fetch = require('node-fetch')
const express = require('express')
const crypto = require('crypto')
const app = express()
const { Client } = require('pg')
const db = new Client()
const {
  KEYGEN_PRODUCT_TOKEN,
  KEYGEN_ACCOUNT_ID,
  KEYGEN_POLICY_ID,
  PORT = 8080
} = process.env

if (KEYGEN_PRODUCT_TOKEN == null) {
  console.error(`[FATAL] Environment variable is required: KEYGEN_PRODUCT_TOKEN`)

  process.exit(1)
}

if (KEYGEN_ACCOUNT_ID == null) {
  console.error(`[FATAL] Environment variable is required: KEYGEN_ACCOUNT_ID`)

  process.exit(1)
}

if (KEYGEN_POLICY_ID == null) {
  console.error(`[FATAL] Environment variable is required: KEYGEN_POLICY_ID`)

  process.exit(1)
}

// Get an HMAC for the provided value, with the Keygen account ID as the secret.
// This allows us to, for example, take an email and produce a unique, reproducible
// license key value that won't change for a given user. It also anonymizes values
// we may want to utilize, such as device IDs.
function getHmacFor(value) {
  return crypto.createHmac('sha256', KEYGEN_ACCOUNT_ID).update(value).digest('hex')
}

// Create a new license resource
async function createLicenseForEmail(email) {
  const [user, host] = email.split('@')
  const key = getHmacFor(email)
  const name = `${host}/${user}`

  console.log(`[INFO] Creating license: key=${key} name=${name}`)

  const res = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'license',
        attributes: { name, key },
        relationships: {
          policy: {
            data: { type: 'policy', id: KEYGEN_POLICY_ID }
          }
        }
      }
    })
  })

  const { data: license, errors } = await res.json()
  if (errors) {
    console.error(`[ERROR] Keygen API error occurred during license creation:`, errors)

    return null
  }

  console.log(`[INFO] Created license: id=${license.id} key=${key} name=${name}`)

  return license
}

// Activate a new machine for a license
async function activateLicenseForDevice(licenseId, deviceId) {
  const fingerprint = getHmacFor(deviceId)

  console.log(`[INFO] Activating machine: id=${licenseId} fingerprint=${fingerprint}`)

  const res = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/machines`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'machine',
        attributes: { fingerprint },
        relationships: {
          license: {
            data: { type: 'license', id: licenseId }
          }
        }
      }
    })
  })

  const { data: machine, errors } = await res.json()
  if (errors) {
    console.error(`[ERROR] Keygen API error occurred during license activation:`, errors)

    return null
  }

  console.log(`[INFO] Activated machine: machine_id=${machine.id} id=${licenseId} fingerprint=${fingerprint}`)

  return machine
}

// Validate the license scoped to the provided device ID
async function validateLicenseForEmailAndDevice(email, deviceId) {
  const fingerprint = getHmacFor(deviceId)
  const key = getHmacFor(email)

  console.log(`[INFO] Validating license: email=${email} device_id=${deviceId} key=${key} fingerprint=${fingerprint}`)

  const res = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/actions/validate-key`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      meta: {
        scope: { fingerprint },
        key,
      }
    })
  })

  const { data, meta, errors } = await res.json()
  if (errors) {
    console.error(`[ERROR] Keygen API error occurred during license validation:`, errors)

    return null
  }

  let license = null
  if (data) {
    license = {
      id: data.id,
      expiry: data.attributes.expiry,
      key: data.attributes.key,
    }
  }

  console.log(`[INFO] Validated license: email=${email} device_id=${deviceId} valid=${meta.valid} code=${meta.code} id=${license?.id ?? ''} key=${key} fingerprint=${fingerprint}`)

  return {
    code: meta.code,
    valid: meta.valid,
    license,
  }
}

// Create a new license and activate the provided device ID
async function checkoutLicenseForEmailAndDevice(email, deviceId) {
  const license = await createLicenseForEmail(email)
  if (license == null) {
    return null
  }

  const activation = await activateLicenseForDevice(license.id, deviceId)
  if (activation == null) {
    return null
  }

  // TODO(ezekg) Email the user their new license key

  return {
    id: license.id,
    expiry: license.attributes.expiry,
    key: license.attributes.key,
  }
}

app.use(express.json())

app.post('/license-requests', async (req, res) => {
  const { email_address, device_id } = req.body
  if (email_address == null) {
    return res.send({ license: null, code: 'EMAIL_ADDRESS_MISSING' })
  }

  if (device_id == null) {
    return res.send({ license: null, code: 'DEVICE_ID_MISSING' })
  }

  // Get the domain from the email address
  const [user, host] = email_address.split('@')
  if (user == null || host == null) {
    return res.send({ license: null, code: 'EMAIL_ADDRESS_INVALID' })
  }

  // Check if the tenant exists
  const { rows } = await db.query('select * from tenants where domain = $1::text limit 1', [host])
  const [tenant] = rows
  if (tenant == null) {
    console.error(`[ERROR] Tenant does not exist: domain=${host}`)

    return res.send({ license: null, code: 'ACCESS_DENIED' })
  }

  console.log(`[INFO] Current tenant: id=${tenant.id} domain=${tenant.domain}`)

  // Check if the license is already checked out and activated (this will come back "valid")
  const validation = await validateLicenseForEmailAndDevice(email_address, device_id)
  if (validation == null) {
    return res.send({ license: null, code: 'LICENSE_VALIDATION_FAILED' })
  }

  // Handle the license validation result
  let license = null

  switch (validation.code) {
    // The license has already been checked out and the provided device ID is activated
    case 'VALID':
      console.log(`[INFO] License is checked out and valid: email=${email_address} device_id=${device_id}`)

      license = validation.license

      break
    // The license has been checked out but it has no activated devices, so we'll
    // want to activate the current device.
    case 'NO_MACHINES':
    case 'NO_MACHINE':
      console.log(`[INFO] License activation required: email=${email_address} device_id=${device_id}`)

      const activation = await activateLicenseForDevice(validation.license.id, device_id)
      if (activation != null) {
        license = validation.license
      }

      break
    // The license has not been checked out for this email, so we'll want to
    // checkout a license and activate the provided device.
    case 'NOT_FOUND':
      console.log(`[INFO] License checkout required: email=${email_address} device_id=${device_id}`)

      license = await checkoutLicenseForEmailAndDevice(email_address, device_id)

      break
    // We want to consider all other validation codes invalid
    default:
      console.log(`[INFO] License is not valid: email=${email_address} device_id=${device_id} code=${validation.code}`)
  }

  if (license == null) {
    return res.send({ license: null, code: 'LICENSE_CHECKOUT_FAILED' })
  }

  return res.send({ license, code: 'OK' })
});

app.listen(PORT, async () => {
  await db.connect()

  console.log(`Server is running on port ${PORT}`)
})
