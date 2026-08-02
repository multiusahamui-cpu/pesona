# Manifest Kubernetes

Sesuai ADR-005: kontainer sejak hari pertama, Kubernetes menyusul saat trafik membenarkannya.

Folder ini disiapkan tapi belum wajib dipakai. Isi nanti:

- Helm chart per layanan (`core-api`, `dispatch`, `location`, `notification`)
- HorizontalPodAutoscaler dengan pemicu berbeda per layanan
- Ingress + cert-manager
- External Secrets Operator — **tidak ada berkas `.env` di produksi**

`dispatch`, `location`, dan `notification` memakai ClusterIP dan tidak pernah diekspos ke internet.
