## 1. Tagging strategy

| Tag Key   | Value when warm | Value when allocated | Set...                                                         |
| --------- | --------------- | -------------------- | -------------------------------------------------------------- |
| Project   | code-server     | code-server          | Launch Template (propagated)                                   |
| Owner     | UNASSIGNED      | <userId>             | Boot → UNASSIGNED<br>Allocate → userId<br>Release → UNASSIGNED |
| Role      | workspace       | workspace            | Launch Template                                                |
| WarmSpare | true            | false (or delete)    | Allocate / Release                                             |

All other metadata lives in Redis; keep AWS tags minimal.

## 2. Launch-template tags (set once)

```hcl
# Terraform / CDK pseudocode
tagSpecifications = [
  {
    resourceType = "instance"
    tags = {
      Project   = "code-server"
      Owner     = "UNASSIGNED"
      Role      = "workspace"
      WarmSpare = "true"
    }
  }
]
propagateAtLaunch = true   # ensures every new instance starts with these
```

This means every brand-new ASG instance boots already tagged as a spare.
