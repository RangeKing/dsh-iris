# Provider isolation boundary

Provider isolation is intentionally not part of dsh-iris. Iris selects and routes capability metadata; DSH/Cordis remains the owner of any future approval, execution, and security isolation boundary. A future design may add a DSH-owned provider runtime with explicit lifecycle, filesystem, network, and resource policy, but Iris must consume an official Agent-scoped seam rather than creating a second sandbox or provider-host protocol.
