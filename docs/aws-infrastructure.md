# Seerticks AWS Infrastructure

> Last updated: 2026-04-19 (post-provision)
> Region: us-east-1 (N. Virginia) — chosen for ~1ms latency to Coinbase Ashburn
> Account: 946732501059
> Isolation: every resource tagged `Project=seerticks`, prefixed `seerticks-`

## Resource manifest

### Network
| Resource | ID | Notes |
|---|---|---|
| VPC | `vpc-0efddc4a330b3c7fb` | CIDR `10.42.0.0/16`, DNS support + hostnames on |
| Internet Gateway | `igw-092e3421b17cc7e62` | Attached to VPC |
| Public subnet 1a | `subnet-0b4df04b1983352ea` | `10.42.1.0/24`, us-east-1a, auto-assign public IP |
| Public subnet 1b | `subnet-0cdc5eaacc7003c8b` | `10.42.2.0/24`, us-east-1b, auto-assign public IP |
| Private subnet 1a | `subnet-02ca94e05e2f31beb` | `10.42.11.0/24`, us-east-1a |
| Private subnet 1b | `subnet-0c250d8f4b7ba05e8` | `10.42.12.0/24`, us-east-1b |
| Public route table | `rtb-07292e5675e01f43d` | Default route → IGW |
| Private route table | `rtb-0594e0d965b17472d` | No internet egress (DB only) |

### Security groups
| Name | ID | Ingress |
|---|---|---|
| seerticks-app-sg | `sg-0b7e518650167dab0` | 22/tcp from admin IP, 80/tcp + 443/tcp world |
| seerticks-db-sg | `sg-065931281e60ba4d9` | 3306/tcp from app-sg only |

### Identity
| Resource | Name |
|---|---|
| Key pair | `seerticks-prod-key` (private at `~/.ssh/seerticks-prod-key.pem`) |
| IAM role | `seerticks-app-role` |
| Instance profile | `seerticks-app-profile` |
| Inline policy | `seerticks-scoped-access` — S3 (own buckets only), Secrets Manager (`seerticks/*`), CloudWatch Logs (`/seerticks/*`), CloudWatch Metrics (namespace `Seerticks`) |

### Storage
| Bucket | Notes |
|---|---|
| `seerticks-logs-946732501059` | AES256, versioned, public access blocked |
| `seerticks-backups-946732501059` | AES256, versioned, public access blocked |
| `seerticks-artifacts-946732501059` | AES256, versioned, public access blocked |

### Observability
| Log group | Retention |
|---|---|
| `/seerticks/app` | 30 days |
| `/seerticks/trading` | 90 days |

### Compute
| Resource | ID / Value | Notes |
|---|---|---|
| EC2 instance | `i-01e65b66799d81dab` | `m6i.xlarge`, Ubuntu 22.04, public subnet 1a, profile `seerticks-app-profile` |
| Elastic IP | `eipalloc-028917d622a96471f` → `100.55.105.55` | Attached to EC2 |
| Private IP | `10.42.1.91` | Used for SG rules / RDS access |
| Root volume | 100GB gp3, encrypted | Default AWS-managed key |
| Hostname | `seerticks-app-prod` | Set via user-data |

### Database
| Resource | Value | Notes |
|---|---|---|
| RDS subnet group | `seerticks-db-subnet-group` | 2 private subnets (1a + 1b) |
| RDS instance | `seerticks-db-prod` | `db.m5.large`, MySQL 8.0.45, us-east-1b |
| RDS resource ID | `db-ZTMYRQBXK6J735DQFDN3N6OZQA` | |
| Endpoint | `seerticks-db-prod.c8fu004m61k4.us-east-1.rds.amazonaws.com:3306` | Private — SG-gated to app-sg only |
| Storage | 100GB gp3, encrypted | 7-day automated backups |
| Master user | `seeradmin` | Password in Secrets Manager |
| Secret ARN | `arn:aws:secretsmanager:us-east-1:946732501059:secret:seerticks/db/master-ObxPn7` | Fetched at runtime by EC2 via IAM role |
| Deletion protection | enabled | Prevents accidental drop |

### Auth — AWS Cognito (replaces Manus OAuth)
| Resource | Value | Notes |
|---|---|---|
| User Pool ID | `us-east-1_SkRU0CyGV` | Name `seerticks-prod`, MFA=OFF, email username, password 12+ chars |
| User Pool ARN | `arn:aws:cognito-idp:us-east-1:946732501059:userpool/us-east-1_SkRU0CyGV` | |
| Hosted UI domain | `https://seerticks-auth.auth.us-east-1.amazoncognito.com` | Managed login v1 |
| App client ID | `6lge90596esoov1l4hbm81klfh` | Name `seerticks-web`, confidential (with secret) |
| Client secret | Secrets Manager | ARN `arn:aws:secretsmanager:us-east-1:946732501059:secret:seerticks/cognito/client-secret-vcj6bg` |
| OAuth flows | authorization_code | Scopes: openid, email, profile |
| Callback URLs | `/api/oauth/callback` on seerticks.com, www.seerticks.com, localhost:3000 | |
| Token validity | Access 60m, ID 60m, Refresh 30d | SRP + refresh-token auth flows enabled |
| Advanced security | AUDIT | Upgradeable to ENFORCED later |

Server env on EC2 reads: `COGNITO_DOMAIN`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_REDIRECT_URI`. Client build reads: `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`.

### TLS
| Resource | Value | Notes |
|---|---|---|
| Let's Encrypt cert | `/etc/letsencrypt/live/seerticks.com/` | SANs: `seerticks.com`, `www.seerticks.com` |
| Renewal | certbot systemd timer | HTTP-01 via nginx plugin, webroot `/var/www/certbot` |
| Expiry | 2026-07-18 | Auto-renews ~30 days prior |

### DNS (external — GoDaddy)
| Record | Target | Notes |
|---|---|---|
| `seerticks.com` A | `100.55.105.55` | EIP |
| `www.seerticks.com` A | `100.55.105.55` | EIP; GoDaddy domain forwarding was disabled (it was silently injecting A records to AWS Global Accelerator IPs) |

**Actual monthly cost (running):** ~$290–310/mo (plus data transfer).

## Reversal
Everything above was created with `Project=seerticks` tags. To nuke: `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=seerticks` lists everything for teardown.

Safety tag: `git tag pre-rebuild` (pre-provision baseline).
