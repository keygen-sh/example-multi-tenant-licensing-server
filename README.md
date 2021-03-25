# Example Multi-tenant Licensing Server

A minimal example of a multi-tenant licensing server that allows valid tenants
to checkout licenses by email address and device ID. The user's checked out
license will be [node-locked](https://keygen.sh/docs/choosing-a-licensing-model/node-locked-licenses/)
to the user's current device. The user will not be able to checkout a different
device until their old device is deactivated, but additional devices can be
manually activated via the admin Dashboard. User access can be revoked by
suspending their license.

> ⚠️ **This example application is not 100% production-ready**, but it should
> get you 90% of the way there. You may need to add additional logging, error
> handling and crash reporting, delivering newly checked out licenses via
> email, etc. ⚠️

The example server is built using:

- Node v14
- Express
- PostgreSQL

This example utilizes a node-locked policy. Cryptographic key schemes are not
supported at this time.

## Running the example

First up, configure a couple environment variables. The values below
are for our `demo` account, which can be used in this example.

```bash
# Your Keygen product API token
export KEYGEN_PRODUCT_TOKEN="prod-xxx"

# Your Keygen account ID
export KEYGEN_ACCOUNT_ID="1fddcec8-8dd3-4d8d-9b16-215cac0f9b52"

# Your Keygen policy ID
export KEYGEN_POLICY_ID="f8c445b4-1692-428f-99dd-f66d591c557c"
```

These environment variables will be used for license and machine activation
requests. All licenses created will implement `KEYGEN_POLICY_ID`.

You can either run each line above within your terminal session before building
the app, or you can add the above contents to your `~/.bashrc` file and then
run `source ~/.bashrc` after saving the file.

Next, install dependencies with [`yarn`](https://yarnpkg.comg):

```
yarn
```

Then start the server:

```
yarn start
```

## Database schema

The example utilizes a local PostgreSQL datastore for tenant information. You
can utilize any datastore you like, but for example purposes we'll be using
`pg` with the following schema:

```sql
drop table if exists tenants;

-- Create the tenants table
create table tenants (
  id serial primary key,
  domain text not null
);

-- Create a unique index on the tenant domain
create unique index
  tenants_domain_idx
on
  tenants (domain);

-- Add some example seed data
insert into tenants
  (domain)
values
  ('tenant-a.example'),
  ('tenant-b.example'),
  ('tenant-c.example');
```

## Checking out a license

To checkout a license, your application will want to send a license request. Your
application should provide an `email_address` parameter and a `device_id`
parameter. Here's what that would look like using `curl`:

```bash
curl -X POST http://localhost:8080/license-requests \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -d '{
        "email_address": "test@tenant-a.example",
        "device_id": "foo-bar-baz"
      }'
```

The `device_id` should be a unique fingerprint for the device being activated,
such as the native device ID.

## Questions?

Reach out at [support@keygen.sh](mailto:support@keygen.sh) if you have any
questions or concerns!
