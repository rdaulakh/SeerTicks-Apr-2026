# Seerticks AWS Infrastructure

> Last updated: 2026-04-19
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

### Database scaffolding
| Resource | Name |
|---|---|
| RDS subnet group | `seerticks-db-subnet-group` (2 private subnets) |

## Not yet provisioned (billable — awaiting confirmation)
- EC2 `m6i.xlarge` Ubuntu 22.04 in public subnet 1a (~$140/mo)
- Elastic IP (free while attached)
- 100GB gp3 root volume (~$8/mo)
- RDS MySQL 8 `db.m5.large` (~$130/mo) with 100GB gp3 (~$11/mo) + 7-day backups

**Estimated monthly cost once running:** ~$290–310/mo (plus data transfer).

## Reversal
Everything above was created with `Project=seerticks` tags. To nuke: `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=seerticks` lists everything for teardown.

Safety tag: `git tag pre-rebuild` (pre-provision baseline).
